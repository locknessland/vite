/**
 * @fileoverview Deno specifier resolver Vite plugin.
 *
 * Vite's default resolver is Node-centric and does not understand Deno's
 * `jsr:`, `npm:` and `https:` import schemes. This plugin intercepts exactly
 * those three forms and resolves them through **Deno's own** resolution:
 * `import.meta.resolve()` for `npm:` and `https:`, and `deno info --json` for
 * `jsr:` (which `import.meta.resolve` returns unchanged). Local and relative
 * imports are left untouched for Vite's default resolver.
 *
 * Security (plan §11, S-F2/S-F7): every specifier is validated against a bounded
 * allowlist (no shell metacharacters, no whitespace) **before** it is resolved.
 * The `npm:`/`https:` paths use no subprocess at all; the `jsr:` path shells to
 * `deno info` via {@link Deno.Command} with an **argument array, never a shell
 * string**, so a crafted specifier has no command-injection sink. `https:`
 * resolution is delegated to Deno, and remote modules are loaded by **reading
 * Deno's integrity-checked cache** (via `deno info`), not by issuing a fresh,
 * unchecked network fetch (S-F7). Pinning/locking `https:` imports is documented
 * for the user at #116.
 *
 * This module imports nothing Lockness-specific (no `../shared.ts`) so the
 * resolver stays reusable outside Lockness (plan §6, A-L2).
 *
 * @module @lockness/vite/plugins/deno
 */

import type { Plugin } from 'vite'
import { fromFileUrl } from '@std/path'

/** The Deno import schemes this resolver owns. */
export type DenoScheme = 'jsr' | 'npm' | 'https'

/**
 * Bounded allowlist patterns for each supported scheme. A specifier that begins
 * with a scheme but fails its pattern is rejected loudly rather than passed on —
 * the charset is deliberately narrow (no shell metacharacters, no whitespace)
 * even though resolution never reaches a shell.
 */
const SCHEME_PATTERNS: Record<DenoScheme, RegExp> = {
    // jsr:@scope/name , optional @version and subpath
    jsr: /^jsr:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:@[^\s/][^\s]*)?$/i,
    // npm:name or npm:@scope/name , optional @version and subpath
    npm: /^npm:(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[^\s/][^\s]*)?(?:\/[^\s]*)?$/i,
    // https://host/path — a bounded URL, no spaces
    https: /^https:\/\/[^\s]+$/i,
}

/**
 * Classify an import specifier by scheme.
 *
 * @param source - The raw import specifier.
 * @returns The matched {@link DenoScheme}, or `null` for anything else
 *   (relative, absolute-path, or bare Node specifiers Vite handles itself).
 *
 * @example
 * ```typescript
 * classifySpecifier('jsr:@std/path')      // 'jsr'
 * classifySpecifier('./local.ts')         // null
 * ```
 */
export function classifySpecifier(source: string): DenoScheme | null {
    if (source.startsWith('jsr:')) return 'jsr'
    if (source.startsWith('npm:')) return 'npm'
    if (source.startsWith('https:')) return 'https'
    return null
}

/**
 * Validate a specifier against its scheme's bounded pattern.
 *
 * @param source - The raw specifier.
 * @param scheme - Its scheme, from {@link classifySpecifier}.
 * @returns `true` when the specifier is well-formed for that scheme.
 */
export function isValidSpecifier(source: string, scheme: DenoScheme): boolean {
    return SCHEME_PATTERNS[scheme].test(source)
}

/** The `deno info --json` payload fields this plugin reads. */
interface DenoInfo {
    roots?: string[]
    redirects?: Record<string, string>
    modules?: Array<{ specifier: string; local?: string }>
}

/**
 * Run `deno info --json <spec>` and parse it. Invoked with {@link Deno.Command}
 * as an argument array (no shell); `spec` has already passed validation (S-F2).
 *
 * @param spec - The specifier to inspect.
 * @returns The parsed `deno info` payload.
 * @throws {Error} When the command fails.
 */
async function runDenoInfo(spec: string): Promise<DenoInfo> {
    const { success, stdout, stderr } = await new Deno.Command('deno', {
        args: ['info', '--json', spec],
        stdout: 'piped',
        stderr: 'piped',
    }).output()
    if (!success) {
        throw new Error(
            `@lockness/vite: \`deno info\` could not resolve "${spec}": ${
                new TextDecoder().decode(stderr).trim()
            }`,
        )
    }
    return JSON.parse(new TextDecoder().decode(stdout)) as DenoInfo
}

/**
 * Resolve a `jsr:` specifier to its concrete module URL via `deno info --json`.
 *
 * `import.meta.resolve` returns `jsr:` specifiers unchanged (the registry mapping
 * is resolved lazily), so jsr: needs Deno's resolver proper. The returned
 * `https://jsr.io/…` URL keeps its real extension, so Vite's pipeline transforms
 * it correctly and the plugin's `load` hook reads it from Deno's cache.
 *
 * @param spec - A validated `jsr:` specifier.
 * @returns The resolved `https:` URL (or a cached `file:` path).
 * @throws {Error} When `deno info` fails or the specifier cannot be resolved.
 */
export async function resolveJsrSpecifier(spec: string): Promise<string> {
    const info = await runDenoInfo(spec)
    const root = info.roots?.[0] ?? spec
    const target = info.redirects?.[root] ?? root
    if (target.startsWith('https:')) return target
    const local = info.modules?.find((m) => m.specifier === target)?.local
    if (local) return local
    throw new Error(
        `@lockness/vite: could not locate a resolved module for "${spec}".`,
    )
}

/**
 * Resolve a Deno specifier to a module id Vite can consume, using Deno's own
 * resolution. `npm:` resolves to a filesystem path (via `import.meta.resolve`),
 * `https:` is returned verbatim for the `load` hook, and `jsr:` is resolved with
 * `deno info` to its `https://jsr.io/…` URL.
 *
 * @param source - A validated `jsr:`/`npm:`/`https:` specifier.
 * @param scheme - Its scheme, from {@link classifySpecifier}.
 * @returns The resolved id (a path for `file:`, or an `https:` URL).
 * @throws {Error} When Deno cannot resolve the specifier — surfaced with the
 *   original specifier so the failure is actionable, never swallowed.
 *
 * @example
 * ```typescript
 * await resolveWithDeno('npm:vite', 'npm') // '/…/node_modules/…/vite/…/index.js'
 * ```
 */
export async function resolveWithDeno(
    source: string,
    scheme: DenoScheme,
): Promise<string> {
    if (scheme === 'jsr') return await resolveJsrSpecifier(source)
    let resolved: string
    try {
        resolved = import.meta.resolve(source)
    } catch (error) {
        throw new Error(
            `@lockness/vite: Deno could not resolve "${source}": ${
                (error as Error).message
            }`,
        )
    }
    if (resolved.startsWith('file:')) return fromFileUrl(resolved)
    return resolved
}

/**
 * The Deno specifier resolver Vite plugin.
 *
 * @returns A Vite {@link Plugin} that resolves `jsr:`/`npm:`/`https:` through
 *   Deno and loads `https:` modules from Deno's cache.
 *
 * @example
 * ```typescript
 * import { denoResolver } from '@lockness/vite'
 * export default { plugins: [denoResolver()] }
 * ```
 */
export function denoResolver(): Plugin {
    return {
        name: 'lockness:deno-resolver',
        enforce: 'pre',
        resolveId(source: string): Promise<string> | null {
            const scheme = classifySpecifier(source)
            if (scheme === null) return null // local/bare — Vite's job.
            if (!isValidSpecifier(source, scheme)) {
                throw new Error(
                    `@lockness/vite: refusing to resolve malformed ${scheme}: specifier "${source}".`,
                )
            }
            return resolveWithDeno(source, scheme)
        },
        load(id: string): Promise<string | null> | null {
            // Only https: (incl. jsr-resolved) modules are loaded here; file
            // paths are read by Vite's default loader.
            if (!id.startsWith('https:')) return null
            return loadRemoteModule(id)
        },
    }
}

/**
 * Load a resolved `https:` (or jsr-resolved) module from **Deno's cache**, not
 * from an arbitrary network fetch (S-F7). `deno info` reports the integrity-
 * checked cached file for the URL; its contents are read from disk. This keeps
 * loading inside Deno's lockfile-backed cache rather than issuing a fresh,
 * unchecked HTTP request.
 *
 * @param url - A resolved `https:` module id.
 * @returns The module source.
 * @throws {Error} When the URL is not in Deno's cache (resolution should have
 *   populated it) or cannot be read.
 *
 * @example
 * ```typescript
 * await loadRemoteModule('https://jsr.io/@std/assert/1.0.17/mod.ts')
 * ```
 */
export async function loadRemoteModule(url: string): Promise<string> {
    const info = await runDenoInfo(url)
    const root = info.roots?.[0] ?? url
    const target = info.redirects?.[root] ?? root
    const local = info.modules?.find((m) => m.specifier === target)?.local
    if (!local) {
        throw new Error(
            `@lockness/vite: "${url}" is not in Deno's cache — resolution should have populated it.`,
        )
    }
    return await Deno.readTextFile(local)
}
