/**
 * @fileoverview Demo application entry point. `createApp` boots the kernel into
 * an `App` whose `fetch` handler the `@lockness/vite` dev bridge forwards to. The
 * default export is what `vite.config.ts` injects into `lockness({ app })`.
 *
 * @module demo/main
 */

import { createApp } from '@lockness/core'
import { DemoKernel } from './kernel.ts'

const app = await createApp(DemoKernel)

if (import.meta.main) {
    await app.listen(Number(Deno.env.get('PORT') || 8899))
}

export default app
