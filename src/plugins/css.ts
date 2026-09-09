/**
 * @fileoverview CSS / Tailwind integration.
 *
 * The Tailwind v4 engine is reached in exactly one place — {@link compileCss}
 * (the decision-table home for "which engine runs", plan-016 §5). Both consumers
 * route through it:
 *
 * - **Dev** ({@link cssPlugin}, `apply: 'serve'`) — Tailwind rebuilds when a
 *   watched `app/**` `.ts`/`.tsx` file changes; the built CSS is collected and
 *   injected into HTML by the dev-server bridge (#108, via its `getCss` hook). The
 *   reload-vs-CSS arbiter lives in `shared.ts` (`classifyChange`) — this plugin only
 *   acts on `'css'` changes; `'server-reload'` is the HMR plugin's job (#112). The
 *   collector **swallows** a failed rebuild (logs, keeps the last good CSS) so the
 *   watcher stays up.
 * - **Build** ({@link buildCssPlugin}, `apply: 'build'`) — a `load` hook returns the
 *   fully-compiled CSS (theme + preflight + utilities) as the content of the
 *   `cssInput` module, so Vite's own CSS pipeline hashes it under the client entry
 *   in the manifest (#156, plan-016 §5). On a failed compile the seam **throws**, so
 *   the build fails loudly rather than shipping an empty stylesheet (FR-004).
 *
 * Both consumers accept an injectable {@link CssCompiler} (defaulting to
 * {@link compileCss}) so their failure/fallback behaviour can be tested without
 * spawning the real Tailwind subprocess (#157).
 *
 * @module @lockness/vite/plugins/css
 */

import type { Plugin } from 'vite'
import { resolve } from '@std/path'
import { defineViteConfig } from '../define_config.ts'
import {
    classifyChange,
    type LocknessViteConfig,
    TAILWIND_CLI,
} from '../shared.ts'

/**
 * Build the full Tailwind CLI argument vector (command + args) for an input →
 * output build. The base command lives in `TAILWIND_CLI` (spelled once, plan §5).
 *
 * @param config - Resolved config (for `cssInput`).
 * @param options - `outFile` target, and an optional absolute `inputFile` that
 *   overrides `config.cssInput` (the build path passes the same absolute path it
 *   matched, so the CLI resolves the entry identically to the load hook — #158).
 * @returns The argv array, e.g. `['deno','run','-A','@tailwindcss/cli','-i',…]`.
 *
 * @example
 * ```typescript
 * buildTailwindArgs(DEFAULTS, { outFile: '/tmp/out.css' })
 * ```
 */
export function buildTailwindArgs(
    config: Required<LocknessViteConfig>,
    options: { outFile: string; inputFile?: string },
): string[] {
    return [
        ...TAILWIND_CLI,
        '-i',
        options.inputFile ?? config.cssInput,
        '-o',
        options.outFile,
    ]
}

/**
 * A function that compiles the Tailwind entry to CSS. {@link compileCss} is the
 * production implementation (spawns the CLI); it is injectable into
 * {@link createCssCollector} and {@link buildCssPlugin} so their fallback / match
 * logic can be tested without a subprocess (#157).
 *
 * @param config - Resolved config (its `cssInput` is the Tailwind entry).
 * @param inputPath - Optional absolute entry path overriding `config.cssInput`.
 * @returns The compiled CSS.
 */
export type CssCompiler = (
    config: Required<LocknessViteConfig>,
    inputPath?: string,
) => Promise<string>

/**
 * Run the Tailwind v4 engine once and return the compiled CSS — the single home
 * (plan-016 §5) for "which engine runs" **and** "how a failure is surfaced".
 *
 * Spawns the `TAILWIND_CLI` argv (argument array, no shell) to an OS temp file,
 * reads the result back, and removes the temp file in a `finally`. **Throws** on a
 * non-zero Tailwind exit, so a build-time caller fails loudly (FR-004); the dev
 * collector wraps this call and swallows the throw to keep its watcher alive.
 *
 * @param config - Resolved config (its `cssInput` is the Tailwind entry).
 * @param inputPath - Optional absolute entry path; when given it is passed to the
 *   CLI verbatim so the build resolves the entry the same way it matched it (#158).
 * @returns The compiled CSS (theme + preflight + the utilities found in source).
 * @throws {Error} When the Tailwind CLI exits non-zero (message carries its stderr).
 *
 * @example
 * ```typescript
 * const css = await compileCss(defineViteConfig())
 * ```
 */
export async function compileCss(
    config: Required<LocknessViteConfig>,
    inputPath?: string,
): Promise<string> {
    const outFile = await Deno.makeTempFile({ suffix: '.css' })
    try {
        const args = buildTailwindArgs(config, {
            outFile,
            inputFile: inputPath,
        })
        const { success, stderr } = await new Deno.Command(args[0], {
            args: args.slice(1),
            stderr: 'piped',
        }).output()
        if (!success) {
            throw new Error(
                `@lockness/vite: Tailwind build failed: ${
                    new TextDecoder().decode(stderr).trim()
                }`,
            )
        }
        return await Deno.readTextFile(outFile)
    } finally {
        await Deno.remove(outFile).catch((error) =>
            console.warn(
                `@lockness/vite: could not remove temp CSS file ${outFile}: ${
                    (error as Error).message
                }`,
            )
        )
    }
}

/** A collector that rebuilds Tailwind CSS and caches the last built output. */
export interface CssCollector {
    /** The most recently built CSS (empty until the first rebuild). */
    getCss(): string
    /** Rebuild the CSS once and cache it (dev: swallows a failed run). */
    rebuild(): Promise<void>
}

/**
 * Create a Tailwind CSS collector for the **dev** path. `rebuild()` runs the
 * compiler and caches the result for `getCss()`; a failed run is logged and the
 * last good CSS is kept, so the dev watcher survives a broken edit. The build path
 * does NOT use this — it calls the compiler directly so a failure throws (FR-004).
 *
 * @param options - `config` (merged over DEFAULTS) and an optional `compile`
 *   override (defaults to {@link compileCss}; injected in tests — #157).
 * @returns A {@link CssCollector}.
 */
export function createCssCollector(
    options: {
        config?: Partial<LocknessViteConfig>
        compile?: CssCompiler
    } = {},
): CssCollector {
    const config = defineViteConfig(options.config)
    const compile = options.compile ?? compileCss
    let css = ''
    return {
        getCss: () => css,
        async rebuild() {
            try {
                css = await compile(config)
            } catch (error) {
                // Dev fallback: keep the watcher alive and the last good CSS
                // served. The build path throws instead (see compileCss).
                console.error(
                    '@lockness/vite: Tailwind build failed:',
                    (error as Error).message,
                )
            }
        },
    }
}

/**
 * The CSS/Tailwind **dev** plugin (`apply: 'serve'`). It never runs during
 * `vite build` — the build path is {@link buildCssPlugin} — so the Tailwind engine
 * is invoked exactly once per build (plan-016 §5, A-arch F3).
 *
 * @param options - `config` and the shared `collector` (so the dev bridge and
 *   this plugin share one CSS source).
 * @returns A Vite {@link Plugin} that rebuilds Tailwind on `'css'` changes.
 *
 * @example
 * ```typescript
 * const collector = createCssCollector()
 * export default { plugins: [cssPlugin({ collector })] }
 * ```
 */
export function cssPlugin(
    options: { config?: Partial<LocknessViteConfig>; collector: CssCollector },
): Plugin {
    return {
        name: 'lockness:css',
        apply: 'serve',
        async buildStart() {
            await options.collector.rebuild() // initial build
        },
        configureServer(server: {
            watcher: { on: (event: string, cb: (path: string) => void) => void }
            ws: { send: (payload: { type: string }) => void }
        }) {
            server.watcher.on('change', async (path: string) => {
                // Only 'css' changes rebuild here; 'server-reload' is the HMR
                // plugin's job, and it wins on overlap (arbiter in shared.ts).
                if (classifyChange(path) !== 'css') return
                await options.collector.rebuild()
                server.ws.send({ type: 'full-reload' })
            })
        },
    }
}

/**
 * The CSS/Tailwind **build** plugin (`apply: 'build'`, `enforce: 'pre'`).
 *
 * Its `load` hook matches the absolute-resolved `cssInput` module and returns the
 * fully-compiled Tailwind CSS as that module's content, so Vite's own CSS pipeline
 * hashes it under the client entry in the manifest (#156, plan-016 §5 / FR-002).
 * The match is on the **absolute** id (Vite passes absolute ids) resolved from
 * `cssInput` against the Vite root — never a literal relative compare, which would
 * silently no-op (A-arch F4). The same absolute path is handed to the compiler, so
 * the CLI resolves the entry identically to the match (no cwd-vs-root skew — #158).
 * A failed compile throws (FR-004).
 *
 * @param options - `config` and an optional `compile` override (defaults to
 *   {@link compileCss}; injected in tests — #157).
 * @returns A Vite {@link Plugin} active only during `vite build`.
 *
 * @example
 * ```typescript
 * export default { plugins: [buildCssPlugin()] }
 * ```
 */
export function buildCssPlugin(
    options: {
        config?: Partial<LocknessViteConfig>
        compile?: CssCompiler
    } = {},
): Plugin {
    const config = defineViteConfig(options.config)
    const compile = options.compile ?? compileCss
    // `cssInputAbs` is the OS-native absolute path handed to the CLI; `cssInputId`
    // is its posix-normalised form used to match Vite's (posix-normalised) ids.
    let cssInputAbs = ''
    let cssInputId = ''
    return {
        name: 'lockness:build-css',
        apply: 'build',
        enforce: 'pre',
        configResolved(resolved: { root: string }) {
            cssInputAbs = resolve(resolved.root, config.cssInput)
            cssInputId = cssInputAbs.replaceAll('\\', '/')
        },
        async load(id: string) {
            // Strip any Vite query suffix (?used, ?direct, …) and normalise
            // separators before matching (see configResolved).
            const path = id.split('?')[0].replaceAll('\\', '/')
            if (path !== cssInputId) return null
            return await compile(config, cssInputAbs)
        },
    }
}
