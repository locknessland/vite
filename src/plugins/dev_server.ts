/**
 * @fileoverview Dev-server bridge Vite plugin.
 *
 * Installs a Vite dev-server middleware that forwards every **non-asset** HTTP
 * request to the Lockness `App.fetch()` handler and streams the response back —
 * so a single `deno task dev` serves both assets (Vite) and SSR pages (Lockness),
 * no second process. The Lockness app is **injected** (`AppFetchHandler`), never
 * imported, so this package never depends on `@lockness/core` (plan §5/§7).
 *
 * Security invariants (plan §11):
 * - **Vite-internal requests never reach `App.fetch()`** — the predicate is an
 *   allowlist of Vite's own prefixes; everything else forwards (S-F5).
 * - **Verbatim forwarding** — method, headers and body are passed through
 *   unaltered so the app's own guards evaluate the true request (S-F6).
 * - **Loopback by default** — the plugin defaults `server.host` to `127.0.0.1`
 *   and keeps `server.fs.strict` on, warning loudly on a non-loopback host, so
 *   the unauthenticated `/@fs` surface is not exposed to the network (S-F1).
 * - **Dev-only CSP widening** — when a forwarded response carries a
 *   `Content-Security-Policy` header, the dev origin is appended to its
 *   `script-src`/`style-src`/`connect-src` directives so the Vite client and HMR
 *   socket load under a strict CSP (#114). This lives **only** in the dev bridge
 *   middleware, which never runs in production, so `localhost:5173` is
 *   structurally absent from a production response (S-F5).
 *
 * @module @lockness/vite/plugins/dev_server
 */

import type { Plugin, UserConfig } from 'vite'
import { defineViteConfig } from '../define_config.ts'
import type { LocknessViteConfig } from '../shared.ts'

/** The minimal shape of a Lockness app the bridge forwards to. */
export interface AppFetchHandler {
    /** Handle a web `Request` and return (a promise of) a `Response`. */
    fetch(request: Request): Response | Promise<Response>
}

/** Options for {@link devServerBridge}. */
export interface DevServerOptions {
    /** The Lockness app handler (injected — never imported). */
    app: AppFetchHandler
    /** Partial Lockness config; merged over DEFAULTS. */
    config?: Partial<LocknessViteConfig>
    /**
     * Optional provider of collected CSS to inject into HTML `<head>` (populated
     * by the CSS plugin, #111). When absent, no CSS is injected here.
     */
    getCss?: () => string
}

/**
 * The Vite-internal request prefixes the bridge must NOT forward to the app.
 * Anything not matching these forwards to `App.fetch()` (default-forward).
 */
const VITE_INTERNAL_PREFIXES: readonly string[] = [
    '/@vite/', // HMR client + ping
    '/@id/', // resolved bare ids
    '/@fs/', // filesystem source access
    '/@react-refresh', // refresh runtime
    '/node_modules/', // pre-bundled deps
    '/__vite', // internal endpoints
]

/**
 * Decide whether a request path belongs to Vite itself (and so must be handled
 * by Vite, not forwarded to `App.fetch()`).
 *
 * @param url - The request URL or path (a full URL or a path is accepted).
 * @returns `true` for Vite-internal/asset requests; `false` (forward) otherwise.
 *
 * @example
 * ```typescript
 * isViteInternalRequest('/@vite/client') // true — Vite handles it
 * isViteInternalRequest('/blog/hello')   // false — forward to App.fetch()
 * ```
 */
export function isViteInternalRequest(url: string): boolean {
    let path = url
    try {
        // Accept a full URL or a bare path.
        path = new URL(url, 'http://localhost').pathname
    } catch {
        // Already a path — use as-is.
    }
    return VITE_INTERNAL_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/**
 * Inject a `<style>` block carrying collected CSS just before `</head>`.
 *
 * @param html - The HTML document.
 * @param css - The CSS to inject; when empty, `html` is returned unchanged.
 * @returns The HTML with the style block inserted (appended if no `</head>`).
 */
export function injectCssIntoHtml(html: string, css: string): string {
    if (!css) return html
    const style = `<style data-lockness-vite>${css}</style>`
    return html.includes('</head>')
        ? html.replace('</head>', `${style}</head>`)
        : html + style
}

/**
 * The CSP directives the dev bridge widens, and how many origins each takes.
 * `connect-src` also needs the WebSocket origin (`ws://…`) for HMR; the other
 * two only need the HTTP origin.
 */
const CSP_DEV_DIRECTIVES: readonly string[] = [
    'script-src',
    'style-src',
    'connect-src',
]

/**
 * Append the Vite dev origin to a CSP's `script-src`/`style-src`/`connect-src`
 * directives so the dev client, modules and HMR socket load under a strict CSP
 * (#114). Only directives **already present** are widened — an absent directive
 * is left to the app's `default-src`, never invented. `connect-src` additionally
 * receives the WebSocket origin (`ws://…`) used by HMR. Idempotent: an origin
 * already listed is not duplicated.
 *
 * This is **dev-only** by construction — it is called solely from the dev bridge
 * middleware, which does not run in production (S-F5).
 *
 * @param csp - The raw `Content-Security-Policy` header value.
 * @param devOrigin - The dev server origin (e.g. `http://localhost:5173`).
 * @returns The widened CSP value (unchanged when no target directive is present).
 *
 * @example
 * ```typescript
 * widenCspForDev("script-src 'self'", 'http://localhost:5173')
 * // "script-src 'self' http://localhost:5173"
 * ```
 */
export function widenCspForDev(csp: string, devOrigin: string): string {
    const http = devOrigin.replace(/\/$/, '')
    const ws = http.replace(/^http/, 'ws')
    return csp
        .split(';')
        .map((directive) => {
            const trimmed = directive.trim()
            if (!trimmed) return directive
            const [name, ...sources] = trimmed.split(/\s+/)
            if (!CSP_DEV_DIRECTIVES.includes(name.toLowerCase())) {
                return directive
            }
            const additions = name.toLowerCase() === 'connect-src'
                ? [http, ws]
                : [http]
            for (const origin of additions) {
                if (!sources.includes(origin)) sources.push(origin)
            }
            return `${name} ${sources.join(' ')}`
        })
        .join(';')
}

/**
 * Determine the dev-server host, defaulting to loopback and warning when a
 * non-loopback host is requested (S-F1). Exported for testing.
 *
 * @param requested - The `server.host` the user config requested (if any).
 * @param warn - Sink for the non-loopback warning (defaults to `console.warn`).
 * @returns The host to bind (`'127.0.0.1'` when none was requested).
 */
export function resolveDevHost(
    requested: string | boolean | undefined,
    warn: (message: string) => void = console.warn,
): string | boolean {
    if (requested === undefined) return '127.0.0.1'
    const isLoopback = requested === '127.0.0.1' || requested === 'localhost' ||
        requested === false
    if (!isLoopback) {
        warn(
            '⚠️  @lockness/vite: the dev server is bound to a non-loopback host ' +
                `(${
                    String(requested)
                }). Vite serves your source and any file ` +
                'under server.fs.allow WITHOUT authentication — only do this on a ' +
                'trusted network.',
        )
    }
    return requested
}

/**
 * The dev-server bridge Vite plugin.
 *
 * @param options - The injected app handler and optional config / CSS provider.
 * @returns A Vite {@link Plugin} that forwards non-asset requests to the app.
 *
 * @example
 * ```typescript
 * import { devServerBridge } from '@lockness/vite'
 * import app from './main.ts'
 * export default { plugins: [devServerBridge({ app })] }
 * ```
 */
export function devServerBridge(options: DevServerOptions): Plugin {
    const config = defineViteConfig(options.config)
    return {
        name: 'lockness:dev-server-bridge',
        config(user: UserConfig): UserConfig {
            // Default to loopback and keep fs.strict on (S-F1).
            const server = { ...user.server }
            server.host = resolveDevHost(server.host)
            server.fs = { strict: true, ...server.fs }
            if (server.port === undefined) server.port = config.port
            // `appType: 'custom'` disables Vite's own HTML-serving and
            // history-fallback middlewares, so every non-asset request reaches
            // the bridge (which forwards it to App.fetch) instead of being
            // rewritten to `/index.html` and 404'd. The app owns all routes.
            // A user who set appType themselves keeps their choice.
            return { server, appType: user.appType ?? 'custom' }
        },
        configureServer(server: {
            middlewares: {
                use: (
                    handler: (
                        req: {
                            url?: string
                            method?: string
                            headers: Record<
                                string,
                                string | string[] | undefined
                            >
                        },
                        res: {
                            statusCode: number
                            setHeader: (k: string, v: string | string[]) => void
                            end: (body?: string | Uint8Array) => void
                        },
                        next: () => void,
                    ) => void,
                ) => void
            }
        }) {
            // Return a post-hook so the bridge runs AFTER Vite's own middlewares
            // (Vite handles its internals first; we take everything else).
            return () => {
                server.middlewares.use(async (req, res, next) => {
                    const url = req.url ?? '/'
                    if (isViteInternalRequest(url)) return next()

                    const request = nodeRequestToWebRequest(req, config)
                    let response: Response
                    try {
                        response = await options.app.fetch(request)
                    } catch (error) {
                        // Never swallow — surface as a 500 and log (no silent catch).
                        console.error(
                            '@lockness/vite: App.fetch() threw:',
                            error,
                        )
                        res.statusCode = 500
                        res.end('Internal Server Error')
                        return
                    }
                    await forwardWebResponse(
                        response,
                        res,
                        options.getCss,
                        config.devServerUrl,
                    )
                })
            }
        },
    }
}

/**
 * Reconstruct a web `Request` from a Connect/Node request, **verbatim** (S-F6).
 *
 * @param req - The incoming Node request (method, url, headers, optional body stream).
 * @param config - Resolved config (for the dev origin).
 * @returns An equivalent web `Request`.
 */
export function nodeRequestToWebRequest(
    req: {
        url?: string
        method?: string
        headers: Record<string, string | string[] | undefined>
        // deno-lint-ignore no-explicit-any -- Node IncomingMessage is an async-iterable stream; typed structurally at this boundary only.
        [Symbol.asyncIterator]?: () => AsyncIterator<any>
    },
    config: Required<LocknessViteConfig>,
): Request {
    const origin = config.devServerUrl.replace(/\/$/, '')
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue
        for (const v of Array.isArray(value) ? value : [value]) {
            headers.append(key, v)
        }
    }
    const method = req.method ?? 'GET'
    const hasBody = method !== 'GET' && method !== 'HEAD' &&
        req[Symbol.asyncIterator] !== undefined
    const init: RequestInit & { duplex?: 'half' } = { method, headers }
    if (hasBody) {
        init.body = ReadableStream.from(
            req as AsyncIterable<Uint8Array>,
        ) as unknown as BodyInit
        // A streamed request body requires duplex:'half' under Deno/undici;
        // without it, constructing the Request throws.
        init.duplex = 'half'
    }
    return new Request(`${origin}${req.url ?? '/'}`, init)
}

/**
 * Forward a web `Response` onto a Connect/Node response, injecting collected CSS
 * into HTML documents (#111 supplies the CSS via `getCss`).
 *
 * @param response - The `Response` from `App.fetch()`.
 * @param res - The Node response to write.
 * @param getCss - Optional collected-CSS provider.
 * @param devOrigin - When set, the dev origin appended to any CSP header's
 *   `script-src`/`style-src`/`connect-src` directives (#114, dev-only — S-F5).
 */
export async function forwardWebResponse(
    response: Response,
    res: {
        statusCode: number
        setHeader: (k: string, v: string | string[]) => void
        end: (body?: string | Uint8Array) => void
    },
    getCss?: () => string,
    devOrigin?: string,
): Promise<void> {
    res.statusCode = response.status
    const contentType = response.headers.get('content-type') ?? ''
    const isHtml = contentType.includes('text/html')
    // When we rewrite the HTML body (CSS injection) the original Content-Length
    // no longer matches — drop it so compliant clients don't truncate (M2).
    const willModifyBody = isHtml && getCss !== undefined
    for (const [key, value] of response.headers) {
        const lower = key.toLowerCase()
        // Set-Cookie must stay as separate headers, not one comma-joined value
        // (Headers iteration merges them) — emit them verbatim below (M1).
        if (lower === 'set-cookie') continue
        if (willModifyBody && lower === 'content-length') continue
        // Widen a strict CSP so the dev client/HMR load (#114, dev-only — S-F5).
        if (
            devOrigin !== undefined &&
            (lower === 'content-security-policy' ||
                lower === 'content-security-policy-report-only')
        ) {
            res.setHeader(key, widenCspForDev(value, devOrigin))
            continue
        }
        res.setHeader(key, value)
    }
    const setCookies = response.headers.getSetCookie()
    if (setCookies.length > 0) res.setHeader('set-cookie', setCookies)

    if (willModifyBody) {
        const html = injectCssIntoHtml(await response.text(), getCss!())
        res.end(html)
        return
    }
    const buffer = new Uint8Array(await response.arrayBuffer())
    res.end(buffer)
}
