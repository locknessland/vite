/**
 * Tests for the dev-server bridge plugin (#108).
 *
 * Pure helpers (predicate, CSS injection, host resolution, request/response
 * conversion) plus an in-process integration of the installed middleware with a
 * fake Connect server and a fake Lockness app — no network required.
 *
 * @module @lockness/vite/tests/dev_server
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import {
    type AppFetchHandler,
    devServerBridge,
    forwardWebResponse,
    injectCssIntoHtml,
    isViteInternalRequest,
    nodeRequestToWebRequest,
    resolveDevHost,
    widenCspForDev,
} from '../src/plugins/dev_server.ts'
import { DEFAULTS } from '../src/shared.ts'

// --- isViteInternalRequest (the security boundary, S-F5) ------------------

Deno.test('isViteInternalRequest - Vite internals are kept, app routes forward', () => {
    for (
        const kept of [
            '/@vite/client',
            '/@id/x',
            '/@fs/etc/passwd',
            '/node_modules/.vite/deps/x.js',
            '/__vite_ping',
        ]
    ) {
        assert(isViteInternalRequest(kept), `${kept} should be kept by Vite`)
    }
    for (
        const fwd of [
            '/',
            '/blog/hello',
            '/api/users',
            '/@handle/profile',
            '/foo/@vite/bar',
        ]
    ) {
        assert(
            !isViteInternalRequest(fwd),
            `${fwd} should forward to App.fetch`,
        )
    }
})

Deno.test('isViteInternalRequest - a full URL is classified by pathname', () => {
    assert(isViteInternalRequest('http://localhost:5173/@vite/client'))
    assert(!isViteInternalRequest('http://localhost:5173/blog'))
})

// --- injectCssIntoHtml -----------------------------------------------------

Deno.test('injectCssIntoHtml - inserts before </head>, no-op on empty css', () => {
    const html = '<html><head><title>x</title></head><body>hi</body></html>'
    const out = injectCssIntoHtml(html, '.a{color:red}')
    assertStringIncludes(
        out,
        '<style data-lockness-vite>.a{color:red}</style></head>',
    )
    assertEquals(injectCssIntoHtml(html, ''), html)
})

Deno.test('injectCssIntoHtml - appends when there is no head', () => {
    assertStringIncludes(
        injectCssIntoHtml('<body>x</body>', '.a{}'),
        '<style data-lockness-vite>.a{}</style>',
    )
})

// --- resolveDevHost (S-F1) -------------------------------------------------

Deno.test('resolveDevHost - defaults to loopback, warns on non-loopback', () => {
    assertEquals(resolveDevHost(undefined), '127.0.0.1')
    let warned = ''
    assertEquals(resolveDevHost('localhost', (m) => warned = m), 'localhost')
    assertEquals(warned, '', 'localhost is loopback — no warning')
    resolveDevHost('0.0.0.0', (m) => warned = m)
    assertStringIncludes(warned, 'non-loopback')
})

// --- nodeRequestToWebRequest (verbatim, S-F6) ------------------------------

Deno.test('nodeRequestToWebRequest - preserves method, path and headers', () => {
    const req = {
        url: '/api/users?q=1',
        method: 'GET',
        headers: { 'x-test': 'v', 'cookie': 'a=b' },
    }
    const request = nodeRequestToWebRequest(req, DEFAULTS)
    assertEquals(request.method, 'GET')
    assertEquals(new URL(request.url).pathname, '/api/users')
    assertEquals(request.headers.get('x-test'), 'v')
    assertEquals(request.headers.get('cookie'), 'a=b')
})

// --- forwardWebResponse ----------------------------------------------------

Deno.test('forwardWebResponse - copies status/headers/body; injects CSS into HTML', async () => {
    const captured: {
        status?: number
        headers: Record<string, string>
        body?: string
    } = { headers: {} }
    const res = {
        statusCode: 0,
        setHeader: (k: string, v: string | string[]) =>
            captured.headers[k] = v as string,
        end: (b?: string | Uint8Array) => {
            captured.body = typeof b === 'string'
                ? b
                : new TextDecoder().decode(b)
        },
    }
    const html = new Response('<html><head></head><body>hi</body></html>', {
        status: 201,
        headers: { 'content-type': 'text/html' },
    })
    await forwardWebResponse(html, res, () => '.x{}')
    assertEquals(res.statusCode, 201)
    assertEquals(captured.headers['content-type'], 'text/html')
    assertStringIncludes(
        captured.body!,
        '<style data-lockness-vite>.x{}</style>',
    )
})

// --- middleware integration (fake server + fake app) -----------------------

Deno.test('devServerBridge - forwards a non-asset request to App.fetch and back', async () => {
    const app: AppFetchHandler = {
        fetch: (request) =>
            new Response(`ROUTE ${new URL(request.url).pathname}`, {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            }),
    }
    let middleware:
        | ((req: unknown, res: unknown, next: () => void) => void)
        | undefined
    const server = {
        middlewares: { use: (h: typeof middleware) => middleware = h },
    }
    const plugin = devServerBridge({ app })
    // configureServer returns a post-hook that installs the middleware.
    const post =
        (plugin.configureServer as unknown as (s: typeof server) => () => void)(
            server,
        )
    post()
    assert(middleware, 'middleware installed')

    // A Vite-internal request is passed through (next called, app untouched).
    let nextCalled = false
    middleware!(
        { url: '/@vite/client', method: 'GET', headers: {} },
        {},
        () => nextCalled = true,
    )
    assert(nextCalled, 'Vite-internal request passed to next()')

    // An app route is forwarded and the response written back.
    const captured: { status?: number; body?: string } = {}
    await new Promise<void>((resolve) => {
        middleware!(
            { url: '/blog/hello', method: 'GET', headers: {} },
            {
                statusCode: 0,
                setHeader: () => {},
                end: (b?: string | Uint8Array) => {
                    captured.body = typeof b === 'string'
                        ? b
                        : new TextDecoder().decode(b)
                    resolve()
                },
                get statusCode_() {
                    return 0
                },
            } as unknown,
            () => resolve(),
        )
    })
    assertStringIncludes(captured.body!, 'ROUTE /blog/hello')
})

Deno.test('devServerBridge - config() defaults host to loopback and keeps fs.strict', () => {
    const plugin = devServerBridge({ app: { fetch: () => new Response('') } })
    const out = (plugin.config as unknown as (
        u: Record<string, unknown>,
    ) => { server: { host: unknown; fs: { strict: boolean } } })({})
    assertEquals(out.server.host, '127.0.0.1')
    assertEquals(out.server.fs.strict, true)
})

Deno.test('devServerBridge - config() sets appType custom so requests reach the bridge (#154)', () => {
    const plugin = devServerBridge({ app: { fetch: () => new Response('') } })
    const call = plugin.config as unknown as (
        u: Record<string, unknown>,
    ) => { appType: string }
    // Default: custom — Vite yields non-asset requests to the bridge instead of
    // rewriting `/` to `/index.html` and 404'ing.
    assertEquals(call({}).appType, 'custom')
    // A user who sets appType themselves keeps their choice.
    assertEquals(call({ appType: 'spa' }).appType, 'spa')
})

// --- review fix-forward: HTTP fidelity (M1/M2/M3) + coverage gaps -----------

/** A fake Node response capturing headers (incl. array-valued) and the body. */
function fakeRes() {
    const headers: Record<string, string | string[]> = {}
    const captured: {
        statusCode: number
        body?: string
        headers: typeof headers
    } = {
        statusCode: 0,
        headers,
    }
    return {
        res: {
            statusCode: 0,
            setHeader: (k: string, v: string | string[]) => {
                headers[k.toLowerCase()] = v
                captured.headers = headers
            },
            end: (b?: string | Uint8Array) => {
                captured.statusCode = captured.statusCode || 0
                captured.body = typeof b === 'string'
                    ? b
                    : b
                    ? new TextDecoder().decode(b)
                    : ''
            },
        },
        captured,
    }
}

Deno.test('forwardWebResponse - multiple Set-Cookie headers survive as an array (M1)', async () => {
    const { res, captured } = fakeRes()
    const headers = new Headers()
    headers.append('set-cookie', 'a=1; Path=/')
    headers.append('set-cookie', 'b=2; Path=/')
    await forwardWebResponse(new Response('ok', { headers }), res)
    const cookies = captured.headers['set-cookie']
    assert(
        Array.isArray(cookies),
        'set-cookie is an array, not one merged value',
    )
    assertEquals((cookies as string[]).length, 2)
})

Deno.test('forwardWebResponse - drops stale Content-Length when CSS is injected (M2)', async () => {
    const { res, captured } = fakeRes()
    const body = '<html><head></head><body>x</body></html>'
    const response = new Response(body, {
        headers: {
            'content-type': 'text/html',
            'content-length': String(body.length),
        },
    })
    await forwardWebResponse(response, res, () => '.big{content:"much longer"}')
    assertEquals(
        captured.headers['content-length'],
        undefined,
        'stale length removed',
    )
    assertStringIncludes(captured.body!, '<style data-lockness-vite>')
})

Deno.test('forwardWebResponse - keeps Content-Length when the body is not modified', async () => {
    const { res, captured } = fakeRes()
    const response = new Response('{"a":1}', {
        headers: { 'content-type': 'application/json', 'content-length': '7' },
    })
    await forwardWebResponse(response, res) // no getCss → not modified
    assertEquals(captured.headers['content-length'], '7')
    assertEquals(captured.body, '{"a":1}')
})

Deno.test('nodeRequestToWebRequest - forwards a POST body verbatim with duplex (M3/S-F6)', async () => {
    const bytes = new TextEncoder().encode('name=lockness')
    const req = {
        url: '/submit',
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        [Symbol.asyncIterator]: async function* () {
            yield bytes
        },
    }
    const request = nodeRequestToWebRequest(req, DEFAULTS)
    assertEquals(request.method, 'POST')
    assertEquals(await request.text(), 'name=lockness')
})

Deno.test('nodeRequestToWebRequest - a GET has no body', () => {
    const request = nodeRequestToWebRequest({
        url: '/',
        method: 'GET',
        headers: {},
    }, DEFAULTS)
    assertEquals(request.body, null)
})

Deno.test('nodeRequestToWebRequest - array-valued headers survive verbatim (S-F6)', () => {
    const request = nodeRequestToWebRequest({
        url: '/',
        method: 'GET',
        headers: { 'x-multi': ['a', 'b'] },
    }, DEFAULTS)
    // Headers.append() for each element → a single comma-joined value on read.
    const value = request.headers.get('x-multi')
    assertStringIncludes(value ?? '', 'a')
    assertStringIncludes(value ?? '', 'b')
})

// --- dev CSP widening (#114) -----------------------------------------------

Deno.test('widenCspForDev - appends the dev origin to present directives only', () => {
    const out = widenCspForDev(
        "script-src 'self'; style-src 'self'; img-src 'self'",
        'http://localhost:5173',
    )
    assertStringIncludes(out, "script-src 'self' http://localhost:5173")
    assertStringIncludes(out, "style-src 'self' http://localhost:5173")
    // img-src is not a target directive — left untouched.
    assertStringIncludes(out, "img-src 'self'")
    assert(
        !out.includes('img-src') || !out.match(/img-src[^;]*localhost/),
        'img-src is never widened',
    )
})

Deno.test('widenCspForDev - connect-src also gets the ws origin for HMR', () => {
    const out = widenCspForDev("connect-src 'self'", 'http://localhost:5173')
    assertStringIncludes(out, 'http://localhost:5173')
    assertStringIncludes(out, 'ws://localhost:5173')
})

Deno.test('widenCspForDev - the ws origin is confined to connect-src', () => {
    const out = widenCspForDev(
        "script-src 'self'; style-src 'self'; connect-src 'self'",
        'http://localhost:5173',
    )
    // Split back into directives so each is asserted in isolation.
    const byName = Object.fromEntries(
        out.split(';').map((d) => {
            const [name, ...rest] = d.trim().split(/\s+/)
            return [name.toLowerCase(), rest]
        }),
    )
    assert(
        !byName['script-src'].includes('ws://localhost:5173'),
        'script-src has no ws',
    )
    assert(
        !byName['style-src'].includes('ws://localhost:5173'),
        'style-src has no ws',
    )
    assert(byName['script-src'].includes('http://localhost:5173'))
    assert(byName['style-src'].includes('http://localhost:5173'))
    assert(
        byName['connect-src'].includes('ws://localhost:5173'),
        'connect-src keeps ws',
    )
})

Deno.test('widenCspForDev - is idempotent and leaves an absent directive alone', () => {
    // default-src only → nothing widened (a target directive is never invented).
    assertEquals(
        widenCspForDev("default-src 'self'", 'http://localhost:5173'),
        "default-src 'self'",
    )
    // Already present → not duplicated.
    const once = widenCspForDev("script-src 'self'", 'http://localhost:5173')
    assertEquals(widenCspForDev(once, 'http://localhost:5173'), once)
})

Deno.test('forwardWebResponse - widens a CSP header when a dev origin is given (#114)', async () => {
    const { res, captured } = fakeRes()
    const response = new Response('ok', {
        headers: { 'content-security-policy': "script-src 'self'" },
    })
    await forwardWebResponse(response, res, undefined, 'http://localhost:5173')
    assertStringIncludes(
        captured.headers['content-security-policy'] as string,
        'http://localhost:5173',
    )
})

Deno.test('forwardWebResponse - leaves the CSP header verbatim without a dev origin (S-F5)', async () => {
    const { res, captured } = fakeRes()
    const response = new Response('ok', {
        headers: { 'content-security-policy': "script-src 'self'" },
    })
    // No devOrigin → production posture → no widening, no dev leak.
    await forwardWebResponse(response, res)
    assertEquals(
        captured.headers['content-security-policy'],
        "script-src 'self'",
    )
    assert(
        !(captured.headers['content-security-policy'] as string).includes(
            'localhost:5173',
        ),
        'no dev origin leaks into a production CSP',
    )
})

Deno.test('forwardWebResponse - widens a report-only CSP header too (#114)', async () => {
    const { res, captured } = fakeRes()
    const response = new Response('ok', {
        headers: {
            'content-security-policy-report-only': "script-src 'self'",
        },
    })
    await forwardWebResponse(response, res, undefined, 'http://localhost:5173')
    assertStringIncludes(
        captured.headers['content-security-policy-report-only'] as string,
        'http://localhost:5173',
    )
})

Deno.test('devServerBridge - App.fetch() throwing yields a 500 (test-reviewer M4)', async () => {
    const app: AppFetchHandler = {
        fetch: () => {
            throw new Error('boom')
        },
    }
    let middleware:
        | ((req: unknown, res: unknown, next: () => void) => void)
        | undefined
    const server = {
        middlewares: { use: (h: typeof middleware) => middleware = h },
    }
    const plugin = devServerBridge({ app })
    ;(plugin.configureServer as unknown as (s: typeof server) => () => void)(
        server,
    )()
    const captured: { status?: number; body?: string } = {}
    await new Promise<void>((resolve) => {
        middleware!(
            { url: '/x', method: 'GET', headers: {} },
            {
                statusCode: 0,
                setHeader: () => {},
                end: (b?: string | Uint8Array) => {
                    captured.body = typeof b === 'string'
                        ? b
                        : new TextDecoder().decode(b as Uint8Array)
                    resolve()
                },
            } as unknown,
            () => resolve(),
        )
    })
    assertStringIncludes(captured.body!, 'Internal Server Error')
})
