/**
 * @fileoverview `lockness()` — the aggregate-root Vite plugin factory (plan §5,
 * §6). It composes the whole integration into the plugin array Vite consumes:
 * the Deno resolver, the client-entry virtual module, the CSS/Tailwind dev
 * plugin (sharing one CSS collector with the dev bridge), the build-time CSS
 * compile plugin (#156), the dev-server bridge, the
 * HMR/server-reload plugin, and the production build config.
 *
 * @module @lockness/vite/lockness
 */

import type { Plugin } from 'vite'
import { denoResolver } from './plugins/deno.ts'
import { clientEntry } from './plugins/client_entry.ts'
import { buildCssPlugin, createCssCollector, cssPlugin } from './plugins/css.ts'
import { type AppFetchHandler, devServerBridge } from './plugins/dev_server.ts'
import { hmrPlugin } from './plugins/hmr.ts'
import { buildConfigPlugin } from './build_config.ts'
import type { LocknessViteConfig } from './shared.ts'

/** Options for the {@link lockness} plugin factory. */
export interface LocknessPluginOptions {
    /** The Lockness app handler (injected — the dev bridge forwards to it). */
    app: AppFetchHandler
    /** Partial config; merged over DEFAULTS. */
    config?: Partial<LocknessViteConfig>
    /** Called before a server reload so the app instance can be re-initialised. */
    onReload?: () => void | Promise<void>
}

/**
 * The Lockness Vite plugin — one call returns every plugin the integration needs.
 *
 * @param options - The injected app handler, optional config and reload hook.
 * @returns The ordered Vite plugin array.
 *
 * @example
 * ```typescript
 * import { lockness } from '@lockness/vite'
 * import app from './main.ts'
 * export default { plugins: [lockness({ app })] }
 * ```
 */
export function lockness(options: LocknessPluginOptions): Plugin[] {
    const { app, config, onReload } = options
    const collector = createCssCollector({ config })
    return [
        denoResolver(),
        clientEntry({ config }),
        cssPlugin({ config, collector }),
        buildCssPlugin({ config }),
        devServerBridge({ app, config, getCss: collector.getCss }),
        hmrPlugin({ onReload }),
        buildConfigPlugin({ config }),
    ]
}
