/**
 * @fileoverview The demo application kernel — the smallest possible Lockness
 * kernel: one controller, no database, session, or devtools. Enough to prove
 * `@lockness/vite` drives a real `@lockness/core` app end-to-end.
 *
 * `controllersDir` is resolved to an **absolute** path from this module's own
 * location so auto-discovery (used in development) finds the demo's controller
 * whether the process runs from the repo root (the e2e test) or from the demo
 * directory (`deno task dev`). The explicit `controllers` list serves production
 * mode, where the framework skips directory discovery.
 *
 * @module demo/kernel
 */

import { dirname, fromFileUrl, join } from '@std/path'
import { Kernel } from '@lockness/core'
import { HomeController } from './app/controller/home_controller.tsx'

const demoDir = dirname(fromFileUrl(import.meta.url))

/** The demo kernel: a single controller, nothing else. */
@Kernel({
    controllersDir: join(demoDir, 'app', 'controller'),
    controllers: [HomeController],
})
export class DemoKernel {}
