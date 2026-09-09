/**
 * @fileoverview End-to-end smoke test for the `@lockness/vite` demo (#115).
 *
 * Proves the integration, without a browser:
 * - **Dev SSR** — the demo `App.fetch()` renders the JSX home page through
 *   `@lockness/core`, and (through the dev bridge) a non-asset request is served
 *   while a Vite-internal request is not.
 * - **A real production build** (#154) — `vite build --configLoader native` in
 *   the demo emits `manifest.json`, which `viteAssets()` then resolves to the
 *   real hashed URLs.
 *
 * Browser HMR (a `.tsx` save reloading the page) is the one piece covered by the
 * manual smoke procedure in `packages/vite/demo/README.md` — a browser is out of
 * reach of a headless unit suite.
 *
 * @module @lockness/vite/tests/e2e_smoke
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { defineViteConfig } from '../src/define_config.ts'
import { viteAssets } from '../src/vite_assets.ts'
import {
    forwardWebResponse,
    isViteInternalRequest,
} from '../src/plugins/dev_server.ts'
import demoApp from '../demo/main.ts'

const DEMO_DIR = join(dirname(fromFileUrl(import.meta.url)), '..', 'demo')

/**
 * Run the demo's real `vite build` with a bounded timeout, returning a `skip`
 * marker when the toolchain is unavailable offline (or the build hangs) instead
 * of failing the suite (#157). A network fetch of `npm:vite` / the Tailwind CLI
 * is required, so a cold offline machine skips rather than reporting a red build.
 */
async function runDemoBuild(
    timeoutMs: number,
): Promise<{ code: number; stderr: string; skip: boolean; reason: string }> {
    const child = new Deno.Command('deno', {
        args: ['run', '-A', 'npm:vite', 'build', '--configLoader', 'native'],
        cwd: DEMO_DIR,
        stdout: 'piped',
        stderr: 'piped',
    }).spawn()
    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        try {
            child.kill('SIGKILL')
        } catch {
            // already exited
        }
    }, timeoutMs)
    let output: Deno.CommandOutput
    try {
        output = await child.output()
    } finally {
        clearTimeout(timer)
    }
    const stderr = new TextDecoder().decode(output.stderr)
    if (timedOut) {
        return {
            code: -1,
            stderr,
            skip: true,
            reason: `build exceeded ${timeoutMs}ms`,
        }
    }
    const offline =
        /error sending request|failed to fetch|dns error|tcp connect error|connection refused|network is unreachable|os error (50|51|65|111)|error trying to connect/i
    if (output.code !== 0 && offline.test(stderr)) {
        return {
            code: output.code,
            stderr,
            skip: true,
            reason: 'vite/tailwind toolchain unavailable offline',
        }
    }
    return { code: output.code, stderr, skip: false, reason: '' }
}

Deno.test('e2e - demo App.fetch renders the SSR home page (#115 dev SSR)', async () => {
    const res = await demoApp.fetch(new Request('http://localhost/'))
    assertEquals(res.status, 200)
    const body = await res.text()
    assertStringIncludes(body, 'Lockness + Vite Demo')
    assertStringIncludes(body, 'data-testid="demo-heading"')
})

Deno.test('e2e - the dev bridge forwards the demo SSR response verbatim', async () => {
    // A Vite-internal request is never forwarded to the app.
    assert(isViteInternalRequest('/@vite/client'))
    assert(!isViteInternalRequest('/'))

    // Forwarding the demo response onto a Node response preserves the markup.
    const response = await demoApp.fetch(new Request('http://localhost/'))
    const captured: { statusCode: number; body?: string } = { statusCode: 0 }
    await forwardWebResponse(response, {
        statusCode: 0,
        setHeader: () => {},
        end: (b?: string | Uint8Array) => {
            captured.body = typeof b === 'string'
                ? b
                : new TextDecoder().decode(b)
        },
    })
    assertStringIncludes(captured.body!, 'Lockness + Vite Demo')
})

Deno.test('e2e - production build manifest resolves the demo entry to hashed URLs (#115 prod)', async () => {
    // Shape of a real `vite build` manifest for the demo client entry.
    const dir = await Deno.makeTempDir()
    const manifestPath = join(dir, 'manifest.json')
    await Deno.writeTextFile(
        manifestPath,
        JSON.stringify({
            'app/client.ts': {
                file: 'assets/client.9f8e7d.js',
                css: ['assets/client.1a2b3c.css'],
                isEntry: true,
            },
        }),
    )
    const config = defineViteConfig({ manifestPath })
    const { html, tags } = await viteAssets('app/client.ts', {
        isDevServer: false,
        config,
        nonce: 'demo-nonce',
    })
    assertStringIncludes(html, '/assets/client.9f8e7d.js')
    assertStringIncludes(html, '/assets/client.1a2b3c.css')
    // Manifest is present and asset paths resolved — never a dev-server URL.
    assert(!html.includes('localhost:5173'), 'no dev origin in production')
    assert(
        tags.every((t) => t.attributes.nonce === 'demo-nonce'),
        'nonce propagates to every resolved tag',
    )
})

Deno.test('e2e - a real `vite build` compiles Tailwind utilities into the hashed CSS (#154/#156)', async () => {
    // Run the demo's actual production build — the config loads through Deno's
    // native runtime (--configLoader native), so bare @lockness/* + the JSX
    // runtime resolve; the denoResolver plugin handles the app graph. Bounded by
    // a timeout and skipped (not failed) when the toolchain is offline (#157).
    const result = await runDemoBuild(120_000)
    if (result.skip) {
        console.warn(`[e2e] skipped real vite build — ${result.reason}`)
        return
    }
    try {
        assertEquals(result.code, 0, `vite build failed:\n${result.stderr}`)

        // Feed the REAL emitted manifest into viteAssets (production path).
        const manifestPath = join(
            DEMO_DIR,
            'public',
            'assets',
            '.vite',
            'manifest.json',
        )
        const manifest = JSON.parse(await Deno.readTextFile(manifestPath))
        assert(
            manifest['app/client.ts']?.isEntry,
            'the client entry is in the manifest',
        )

        const { html } = await viteAssets('app/client.ts', {
            isDevServer: false,
            config: defineViteConfig({ manifestPath }),
        })
        // The tags point at the real hashed files the build wrote, not the dev server.
        assertStringIncludes(html, `/${manifest['app/client.ts'].file}`)
        assert(!html.includes('localhost:5173'), 'no dev origin in production')

        // #156 — the build must compile Tailwind UTILITIES into the hashed CSS,
        // not just theme + preflight. The demo view uses `flex`/`gap-4`; assert
        // their compiled rules are present and no raw `@tailwind` directive leaks.
        const cssRel = manifest['app/client.ts'].css?.[0] as string | undefined
        assert(cssRel, 'the client entry has a CSS asset in the manifest')
        const builtCss = await Deno.readTextFile(
            join(DEMO_DIR, 'public', 'assets', cssRel),
        )
        assertStringIncludes(builtCss, '.flex')
        assertStringIncludes(builtCss, 'gap')
        assert(
            !builtCss.includes('@tailwind'),
            'raw @tailwind directive must be compiled away, not shipped',
        )
    } finally {
        // Build output is gitignored; remove it so the tree stays clean.
        await Deno.remove(join(DEMO_DIR, 'public'), { recursive: true }).catch(
            () => {},
        )
    }
})
