/**
 * @fileoverview Internal barrel for `@lockness/vite`. Re-exported by the
 * package's public `mod.ts`.
 *
 * @module @lockness/vite/src
 */

export {
    classifySpecifier,
    denoResolver,
    type DenoScheme,
    isValidSpecifier,
    resolveJsrSpecifier,
    resolveWithDeno,
} from './plugins/deno.ts'
export { defineViteConfig } from './define_config.ts'
export {
    CSS_WATCH_GLOBS,
    DEFAULTS,
    type LocknessViteConfig,
    SERVER_RELOAD_GLOBS,
    TAILWIND_CLI,
} from './shared.ts'

export {
    type AppFetchHandler,
    devServerBridge,
    type DevServerOptions,
    injectCssIntoHtml,
    isViteInternalRequest,
} from './plugins/dev_server.ts'

export {
    CLIENT_ENTRY_ID,
    clientEntry,
    type ClientEntryOptions,
    generateClientEntry,
    RESOLVED_CLIENT_ENTRY_ID,
} from './plugins/client_entry.ts'

export {
    type ManifestChunk,
    ManifestReader,
    type ViteManifest,
    type ViteMode,
} from './manifest_reader.ts'
export {
    encodeAttribute,
    viteAssets,
    type ViteAssetsOptions,
    type ViteAssetsTagResult,
    type ViteAssetTag,
} from './vite_assets.ts'

export {
    buildCssPlugin,
    buildTailwindArgs,
    compileCss,
    createCssCollector,
    type CssCollector,
    type CssCompiler,
    cssPlugin,
} from './plugins/css.ts'
export { type ChangeKind, classifyChange } from './shared.ts'

export { type HmrOptions, hmrPlugin } from './plugins/hmr.ts'

export {
    buildConfig,
    buildConfigPlugin,
    type LocknessBuildOptions,
} from './build_config.ts'
export { lockness, type LocknessPluginOptions } from './lockness.ts'

// ViteAssetsTagResult.
