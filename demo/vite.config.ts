/**
 * @fileoverview Vite config for the demo — the whole integration in one call.
 * `lockness({ app })` returns every plugin the dev server and build need; the
 * app is injected (never imported by the package itself).
 *
 * @module demo/vite.config
 */

import { lockness } from '@lockness/vite'
import app from './main.ts'

export default {
    plugins: lockness({ app }),
}
