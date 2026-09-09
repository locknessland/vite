/**
 * @fileoverview Shared, pure-data kernel for `@lockness/vite` — the single home
 * (plan §5 decision table) for the configurable-path `DEFAULTS`, the watcher
 * glob sets, and the Tailwind CLI invocation. **No I/O lives here** (manifest
 * access and mode detection live on `ManifestReader`).
 *
 * @module @lockness/vite/shared
 */

import { globToRegExp } from '@std/path'

/**
 * User-configurable options for the Lockness Vite integration. Every field has a
 * value in {@link DEFAULTS}; user config is merged over the defaults by
 * `defineViteConfig`.
 */
export interface LocknessViteConfig {
    /** The Deno/Lockness server entrypoint — referenced for reloads, never bundled. */
    serverEntry: string
    /** The single client entrypoint Vite bundles. */
    clientEntry: string
    /** Directory scanned for controllers (drives server-reload watching). */
    routeDir: string
    /** Output directory for built client assets. */
    outDir: string
    /** Path to the Vite build manifest. */
    manifestPath: string
    /** Client-facing dev server URL used by `viteAssets` in dev. */
    devServerUrl: string
    /** Tailwind CSS entry file the dev watcher rebuilds. */
    cssInput: string
    /** Port the dev server listens on. */
    port: number
}

/**
 * Authoritative default values for every {@link LocknessViteConfig} field — the
 * one place these paths are spelled (plan §5). A plugin needing any of them
 * reads `DEFAULTS`, never a literal.
 */
export const DEFAULTS: Required<LocknessViteConfig> = {
    serverEntry: 'main.ts',
    clientEntry: 'app/client.ts',
    routeDir: 'app/controller',
    outDir: 'public/assets',
    manifestPath: 'public/assets/.vite/manifest.json',
    devServerUrl: 'http://localhost:5173',
    cssInput: 'app/view/assets/app.css',
    port: 5173,
}

/**
 * Globs whose changes trigger a full server reload (#112). A change under any of
 * these re-initialises the Lockness app so `App.fetch()` runs the new code.
 */
export const SERVER_RELOAD_GLOBS: readonly string[] = [
    'app/controller/**',
    'app/service/**',
    'app/middleware/**',
    'app/routes.ts',
    'config/**',
]

/**
 * Globs whose changes drive a Tailwind rebuild (#111). These overlap
 * {@link SERVER_RELOAD_GLOBS} for a `.tsx` under `app/controller/`; on overlap
 * **the server reload wins** (a full reload already refreshes the page and its
 * CSS), and a pure `.css` edit matches neither set. This precedence is the
 * decision-table home for the glob arbiter (plan §5).
 */
export const CSS_WATCH_GLOBS: readonly string[] = [
    'app/**/*.ts',
    'app/**/*.tsx',
]

/**
 * Base Tailwind CLI invocation (command + leading args). #111 appends
 * `-i <cssInput> -o <out> [--watch]`; kept here so the command is spelled once.
 */
export const TAILWIND_CLI: readonly string[] = [
    'deno',
    'run',
    '-A',
    '@tailwindcss/cli',
]

/** How a changed file should be handled by the dev watcher. */
export type ChangeKind = 'server-reload' | 'css' | 'ignore'

const toMatchers = (globs: readonly string[]): RegExp[] =>
    globs.map((g) => globToRegExp(g, { extended: true, globstar: true }))

const SERVER_RELOAD_MATCHERS = toMatchers(SERVER_RELOAD_GLOBS)
const CSS_WATCH_MATCHERS = toMatchers(CSS_WATCH_GLOBS)

/**
 * Classify a changed file path — the single home for the reload-vs-CSS glob
 * arbiter (plan §5). **Server-reload wins** on overlap (a `.tsx` under
 * `app/controller/` is a server reload, which already refreshes the page and its
 * CSS); a file matching only the CSS globs is a `'css'` rebuild; anything else is
 * `'ignore'`.
 *
 * @param path - The changed path (project-relative; a leading `./` is stripped).
 * @returns The {@link ChangeKind} for that path.
 *
 * @example
 * ```typescript
 * classifyChange('app/controller/home.tsx') // 'server-reload' (wins over css)
 * classifyChange('app/view/card.tsx')       // 'css'
 * classifyChange('README.md')               // 'ignore'
 * ```
 */
export function classifyChange(path: string): ChangeKind {
    const p = path.replace(/^\.\//, '')
    if (SERVER_RELOAD_MATCHERS.some((re) => re.test(p))) return 'server-reload'
    if (CSS_WATCH_MATCHERS.some((re) => re.test(p))) return 'css'
    return 'ignore'
}
