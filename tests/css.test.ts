/**
 * Tests for the CSS/Tailwind integration (#111, #156, #158).
 *
 * Failure-path and match-logic tests inject a fake {@link CssCompiler} so they
 * never spawn the real Tailwind subprocess (#157). The one test that exercises
 * the real CLI is gated behind `LOCKNESS_VITE_INTEGRATION=1` (and the real
 * `vite build` is covered by the e2e smoke test).
 *
 * @module @lockness/vite/tests/css
 */

import { assert, assertEquals, assertRejects } from '@std/assert'
import { resolve } from '@std/path'
import {
    buildCssPlugin,
    buildTailwindArgs,
    compileCss,
    createCssCollector,
    type CssCompiler,
    cssPlugin,
} from '../src/plugins/css.ts'
import { DEFAULTS } from '../src/shared.ts'

const INTEGRATION = Deno.env.get('LOCKNESS_VITE_INTEGRATION') === '1'

/** A compiler that always fails — for the swallow / throw-propagation paths. */
const failing: CssCompiler = () =>
    Promise.reject(new Error('@lockness/vite: Tailwind build failed: boom'))

Deno.test('buildTailwindArgs - assembles the CLI vector; inputFile overrides cssInput', () => {
    const args = buildTailwindArgs(DEFAULTS, { outFile: '/tmp/out.css' })
    assertEquals(args.slice(0, 4), ['deno', 'run', '-A', '@tailwindcss/cli'])
    assertEquals(args, [
        'deno',
        'run',
        '-A',
        '@tailwindcss/cli',
        '-i',
        DEFAULTS.cssInput,
        '-o',
        '/tmp/out.css',
    ])
    // An absolute inputFile (the build path) is used verbatim in place of cssInput.
    const abs = buildTailwindArgs(DEFAULTS, {
        outFile: '/tmp/o.css',
        inputFile: '/abs/root/app/view/assets/app.css',
    })
    assertEquals(abs[5], '/abs/root/app/view/assets/app.css')
})

Deno.test('createCssCollector - getCss is empty before the first rebuild', () => {
    assertEquals(createCssCollector().getCss(), '')
})

Deno.test('createCssCollector.rebuild - caches the compiled CSS (injected compiler, no subprocess)', async () => {
    const collector = createCssCollector({
        compile: () => Promise.resolve('.ok{}'),
    })
    await collector.rebuild()
    assertEquals(collector.getCss(), '.ok{}')
})

Deno.test('createCssCollector.rebuild - swallows a failed run and logs (dev fallback, FR-004 dev side)', async () => {
    // The build path throws; the DEV collector must keep the watcher alive — log
    // the failure and leave the last good CSS in place. Hermetic: the failure is
    // an injected rejection, no Tailwind subprocess is spawned (#157).
    const collector = createCssCollector({ compile: failing })
    const errors: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
        errors.push(args)
    }
    try {
        await collector.rebuild() // must NOT reject
    } finally {
        console.error = original
    }
    assertEquals(collector.getCss(), '') // stayed empty, never a partial write
    assert(errors.length >= 1, 'the failed run is logged at ERROR')
})

Deno.test('cssPlugin - a css change rebuilds and reloads; a server-reload change is ignored here', async () => {
    let rebuilds = 0
    const collector = {
        getCss: () => '.x{}',
        rebuild: () => {
            rebuilds++
            return Promise.resolve()
        },
    }
    const sent: string[] = []
    let onChange: ((p: string) => void) | undefined
    const server = {
        watcher: { on: (_e: string, cb: (p: string) => void) => onChange = cb },
        ws: { send: (p: { type: string }) => sent.push(p.type) },
    }
    const plugin = cssPlugin({ collector })
    ;(plugin.configureServer as unknown as (s: typeof server) => void)(server)
    assert(onChange)
    await onChange!('app/view/card.tsx') // 'css' → rebuild + reload
    await onChange!('app/controller/home.tsx') // 'server-reload' → ignored here
    await onChange!('README.md') // 'ignore'
    assertEquals(rebuilds, 1)
    assertEquals(sent, ['full-reload'])
})

Deno.test('cssPlugin - is serve-only so the build path compiles Tailwind once', () => {
    const plugin = cssPlugin({ collector: createCssCollector() })
    assertEquals(plugin.apply, 'serve')
})

Deno.test('buildCssPlugin - is build-only, pre-enforced, and named', () => {
    const plugin = buildCssPlugin()
    assertEquals(plugin.name, 'lockness:build-css')
    assertEquals(plugin.apply, 'build')
    assertEquals(plugin.enforce, 'pre')
})

Deno.test('buildCssPlugin - load matches the ABSOLUTE-resolved cssInput and compiles with that same path (#156/#158)', async () => {
    // Hermetic: inject a compiler that records the input path it is handed, so we
    // assert the match logic AND that the build resolves cssInput the same way it
    // matched it (no cwd-vs-root skew) without spawning Tailwind (#157/#158).
    const root = '/some/project/root'
    const cssInput = 'app/view/assets/app.css'
    const calls: Array<string | undefined> = []
    const compile: CssCompiler = (_config, inputPath) => {
        calls.push(inputPath)
        return Promise.resolve('.compiled{}')
    }
    const plugin = buildCssPlugin({ config: { cssInput }, compile })
    ;(plugin.configResolved as unknown as (r: { root: string }) => void)({
        root,
    })
    const load = plugin.load as unknown as (
        id: string,
    ) => Promise<string | null>

    const absId = resolve(root, cssInput)
    // The exact bug the plan warns about (A-arch F4): a bare relative literal, and
    // any unrelated id, must NOT match — otherwise utilities silently never compile.
    assertEquals(await load(cssInput), null)
    assertEquals(await load('/unrelated/module.ts'), null)
    assertEquals(calls.length, 0, 'no compile for a non-matching id')

    // The absolute-resolved id DOES match → compiles, and is handed that same
    // absolute path (the #158 cwd-vs-root fix), suffix-stripped.
    assertEquals(await load(absId), '.compiled{}')
    assertEquals(await load(`${absId}?used`), '.compiled{}')
    assertEquals(
        calls,
        [absId, absId],
        'compiled with the matched absolute path',
    )
})

Deno.test('buildCssPlugin - load propagates a compile failure (build fails loudly, FR-004)', async () => {
    const root = '/some/project/root'
    const cssInput = 'app/view/assets/app.css'
    const plugin = buildCssPlugin({ config: { cssInput }, compile: failing })
    ;(plugin.configResolved as unknown as (r: { root: string }) => void)({
        root,
    })
    const load = plugin.load as unknown as (
        id: string,
    ) => Promise<string | null>
    await assertRejects(
        () => load(resolve(root, cssInput)),
        Error,
        'Tailwind build failed',
    )
})

Deno.test({
    name:
        '[integration] compileCss - throws on a failed Tailwind run (real CLI, FR-004)',
    ignore: !INTEGRATION,
    async fn() {
        // Exercises the real @tailwindcss/cli subprocess; gated behind
        // LOCKNESS_VITE_INTEGRATION=1 so the default suite stays hermetic (#157).
        // A nonexistent cssInput makes the CLI exit non-zero → the seam throws.
        const { defineViteConfig } = await import('../src/define_config.ts')
        const config = defineViteConfig({
            cssInput: '/nonexistent/does-not-exist.css',
        })
        await assertRejects(
            () => compileCss(config),
            Error,
            'Tailwind build failed',
        )
    },
})
