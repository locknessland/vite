/**
 * @fileoverview Production build configuration.
 *
 * Turns on Vite's manifest and points the client build at the configured client
 * entry and output dir. No SSR build artifact is produced — the Lockness server
 * keeps running under Deno directly (#113); only the client bundle + manifest are
 * emitted, and `viteAssets()` reads that manifest in production (#110/T06).
 *
 * @module @lockness/vite/build_config
 */

import type { Plugin, UserConfig } from 'vite'
import { defineViteConfig } from './define_config.ts'
import type { LocknessViteConfig } from './shared.ts'

/** The Vite `build` options Lockness sets for a production build. */
export interface LocknessBuildOptions {
    /** Emit `<outDir>/.vite/manifest.json`. */
    manifest: true
    /** Client asset output directory. */
    outDir: string
    /** Do not wipe a shared `public/` tree on build. */
    emptyOutDir: false
    /** Rollup/Rolldown input — the single client entry. */
    rollupOptions: { input: string }
}

/**
 * Compute the Vite `build` config from a resolved Lockness config.
 *
 * @param config - Resolved config (outDir, clientEntry).
 * @returns The `{ build }` fragment to merge into the Vite config.
 *
 * @example
 * ```typescript
 * buildConfig(DEFAULTS).build.manifest // true
 * ```
 */
export function buildConfig(
    config: Required<LocknessViteConfig>,
): { build: LocknessBuildOptions } {
    return {
        build: {
            manifest: true,
            outDir: config.outDir,
            emptyOutDir: false,
            rollupOptions: { input: config.clientEntry },
        },
    }
}

/**
 * A Vite plugin that applies {@link buildConfig} through the `config` hook.
 *
 * @param options - `config` (merged over DEFAULTS).
 * @returns A Vite {@link Plugin}.
 */
export function buildConfigPlugin(
    options: { config?: Partial<LocknessViteConfig> } = {},
): Plugin {
    const config = defineViteConfig(options.config)
    return {
        name: 'lockness:build-config',
        config(): UserConfig {
            return buildConfig(config) as unknown as UserConfig
        },
    }
}
