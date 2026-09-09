/**
 * @fileoverview The demo's single controller — renders the SSR home page and
 * wires in `@lockness/vite`'s `viteAssets()` so the correct asset tags (dev
 * server URLs in dev, hashed manifest URLs in production) land in the document.
 *
 * @module demo/controller/home
 */

import { Controller, Get } from '@lockness/core'
import type { Context } from '@lockness/core'
import { viteAssets } from '@lockness/vite'
import { Home } from '../view/home.tsx'

/** Serves the demo home page at `/`. */
@Controller('/')
export class HomeController {
    /**
     * Render the home page with `@lockness/vite` asset tags injected.
     *
     * `LOCKNESS_VITE_DEV=1` (set by the demo `dev` task) selects the dev-server
     * asset URLs; otherwise `viteAssets()` resolves hashed URLs from the built
     * manifest.
     *
     * @param c - The request context.
     * @returns The rendered HTML response.
     */
    @Get('/', { name: 'home' })
    async index(c: Context) {
        const isDevServer = Deno.env.get('LOCKNESS_VITE_DEV') === '1'
        const { html } = await viteAssets('app/client.ts', { isDevServer })
        return c.html(<Home assetTags={html} />)
    }
}
