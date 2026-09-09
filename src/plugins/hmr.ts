/**
 * @fileoverview HMR + server-reload plugin.
 *
 * When a backend file (controller / service / middleware / routes / config)
 * changes, the dev server must re-initialise the Lockness app and reload the
 * browser so `App.fetch()` runs the new code. Which paths count is the shared
 * arbiter `classifyChange` (`shared.ts`): only `'server-reload'` changes trigger
 * here — a `'css'` change is the CSS plugin's job (#111), and `'server-reload'`
 * wins on overlap, so a `.tsx` under `app/controller/` reloads the server (which
 * also refreshes the page and its CSS).
 *
 * @module @lockness/vite/plugins/hmr
 */

import type { Plugin } from 'vite'
import { classifyChange } from '../shared.ts'

/** Options for {@link hmrPlugin}. */
export interface HmrOptions {
    /**
     * Called when a server-reload change is detected, before the browser reload —
     * the seam the `lockness()` factory uses to re-initialise the app instance so
     * the next `App.fetch()` runs the new code.
     */
    onReload?: () => void | Promise<void>
}

/**
 * The HMR / server-reload plugin.
 *
 * @param options - Optional `onReload` app re-init hook.
 * @returns A Vite {@link Plugin} that full-reloads on backend changes.
 *
 * @example
 * ```typescript
 * hmrPlugin({ onReload: () => reinitApp() })
 * ```
 */
export function hmrPlugin(options: HmrOptions = {}): Plugin {
    return {
        name: 'lockness:hmr',
        configureServer(server: {
            watcher: { on: (event: string, cb: (path: string) => void) => void }
            ws: { send: (payload: { type: string }) => void }
        }) {
            server.watcher.on('change', async (path: string) => {
                if (classifyChange(path) !== 'server-reload') return
                await options.onReload?.()
                server.ws.send({ type: 'full-reload' })
            })
        },
    }
}
