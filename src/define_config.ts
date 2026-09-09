/**
 * @fileoverview `defineViteConfig()` — merges a partial user config over the
 * authoritative {@link DEFAULTS}, giving every Lockness Vite plugin a single,
 * fully-populated config object.
 *
 * @module @lockness/vite/define_config
 */

import { DEFAULTS, type LocknessViteConfig } from './shared.ts'

/** Replace the port of an origin, preserving protocol + host (no trailing slash). */
function withPort(url: string, port: number): string {
    try {
        const u = new URL(url)
        return `${u.protocol}//${u.hostname}:${port}`
    } catch {
        return url // Malformed URL — leave it; viteAssets will surface it.
    }
}

/** The port encoded in an origin, or `undefined` when it cannot be parsed. */
function portOf(url: string): number | undefined {
    try {
        const explicit = new URL(url).port
        return explicit ? Number(explicit) : undefined
    } catch {
        return undefined
    }
}

/**
 * Merge a partial Lockness Vite config over {@link DEFAULTS}.
 *
 * Only the keys the caller provides override the defaults; every other key keeps
 * its `DEFAULTS` value, so the result is always fully populated.
 *
 * `port` and `devServerUrl` both carry the dev port, so they are **reconciled**:
 * override one without the other and the missing side is derived from it, so the
 * bound port and the asset-URL port can never silently disagree. Override both
 * and each is taken as given (the caller owns the split).
 *
 * @param config - A partial config; omitted keys fall back to `DEFAULTS`.
 * @returns A fully-resolved config with every field set.
 *
 * @example
 * ```typescript
 * defineViteConfig({ port: 3000 }).devServerUrl // 'http://localhost:3000'
 * defineViteConfig({ devServerUrl: 'http://localhost:4000' }).port // 4000
 * ```
 */
export function defineViteConfig(
    config: Partial<LocknessViteConfig> = {},
): Required<LocknessViteConfig> {
    // Drop explicit `undefined` values so `{ port: undefined }` keeps the default
    // rather than punching a hole in the Required<> result.
    const provided: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(config)) {
        if (value !== undefined) provided[key] = value
    }
    const merged = { ...DEFAULTS, ...(provided as Partial<LocknessViteConfig>) }

    // Keep the dev port single-sourced: a partial override of one side derives
    // the other, so the bound port and the asset-URL port cannot desync.
    const gavePort = 'port' in provided
    const gaveUrl = 'devServerUrl' in provided
    if (gavePort && !gaveUrl) {
        merged.devServerUrl = withPort(merged.devServerUrl, merged.port)
    } else if (gaveUrl && !gavePort) {
        const parsed = portOf(merged.devServerUrl)
        if (parsed !== undefined) merged.port = parsed
    }
    return merged
}
