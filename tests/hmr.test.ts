/**
 * Tests for the HMR / server-reload plugin (#112).
 *
 * @module @lockness/vite/tests/hmr
 */

import { assert, assertEquals } from '@std/assert'
import { hmrPlugin } from '../src/plugins/hmr.ts'

Deno.test('hmrPlugin - server-reload change re-inits the app and reloads; css/ignore do not', async () => {
    let reloads = 0
    const sent: string[] = []
    let onChange: ((p: string) => void) | undefined
    const server = {
        watcher: { on: (_e: string, cb: (p: string) => void) => onChange = cb },
        ws: { send: (p: { type: string }) => sent.push(p.type) },
    }
    const plugin = hmrPlugin({
        onReload: () => {
            reloads++
        },
    })
    ;(plugin.configureServer as unknown as (s: typeof server) => void)(server)
    assert(onChange)
    await onChange!('app/controller/home.tsx') // server-reload
    await onChange!('app/view/card.tsx') // css → not a server reload
    await onChange!('README.md') // ignore
    assertEquals(reloads, 1)
    assertEquals(sent, ['full-reload'])
})
