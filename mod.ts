/**
 * @fileoverview Public surface of `@lockness/vite` — the Deno-native Vite
 * integration for Lockness.
 *
 * The primary entry point is {@link lockness}, which composes the whole
 * integration. The individual plugin factories and the config / asset / manifest
 * helpers are also public for advanced use. Internal helpers (specifier
 * classification, tag encoding, glob matching, …) are intentionally **not**
 * exported here — they live under `./src/` for internal use and testing and are
 * not part of the package's semver-committed surface.
 *
 * @module @lockness/vite
 */

// Primary entry point — the aggregate-root factory.
export { lockness, type LocknessPluginOptions } from './src/lockness.ts'

// Configuration.
export { defineViteConfig } from './src/define_config.ts'
export { DEFAULTS, type LocknessViteConfig } from './src/shared.ts'

// Asset helper + manifest.
export {
    viteAssets,
    type ViteAssetsOptions,
    type ViteAssetsTagResult,
    type ViteAssetTag,
} from './src/vite_assets.ts'
export {
    type ManifestChunk,
    ManifestReader,
    type ViteManifest,
    type ViteMode,
} from './src/manifest_reader.ts'

// Individual plugin factories (composed by `lockness()`; public for advanced use).
export { denoResolver, type DenoScheme } from './src/plugins/deno.ts'
export {
    type AppFetchHandler,
    devServerBridge,
    type DevServerOptions,
} from './src/plugins/dev_server.ts'
export {
    clientEntry,
    type ClientEntryOptions,
} from './src/plugins/client_entry.ts'
export {
    buildCssPlugin,
    compileCss,
    createCssCollector,
    type CssCollector,
    type CssCompiler,
    cssPlugin,
} from './src/plugins/css.ts'
export { type HmrOptions, hmrPlugin } from './src/plugins/hmr.ts'
export { buildConfigPlugin } from './src/build_config.ts'
