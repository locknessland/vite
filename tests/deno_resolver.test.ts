/**
 * Tests for the Deno specifier resolver plugin (#106).
 *
 * Covers the four AC cases — `jsr:` / `npm:` / `https:` resolve, and a local
 * relative import passes through — plus specifier classification/validation and
 * the malformed-specifier guard.
 *
 * @module @lockness/vite/tests/deno_resolver
 */

import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
    classifySpecifier,
    denoResolver,
    isValidSpecifier,
    resolveWithDeno,
} from '../src/plugins/deno.ts'

// --- classifySpecifier / isValidSpecifier (pure units) --------------------

Deno.test('classifySpecifier - recognises the three schemes, null otherwise', () => {
    assertEquals(classifySpecifier('jsr:@std/path'), 'jsr')
    assertEquals(classifySpecifier('npm:vite@^8'), 'npm')
    assertEquals(classifySpecifier('https://esm.sh/x'), 'https')
    assertEquals(classifySpecifier('./local.ts'), null)
    assertEquals(classifySpecifier('../x/y.ts'), null)
    assertEquals(classifySpecifier('node:fs'), null)
})

Deno.test('isValidSpecifier - accepts well-formed, rejects metacharacters/whitespace', () => {
    assert(isValidSpecifier('jsr:@std/assert@1', 'jsr'))
    assert(isValidSpecifier('npm:vite@^8', 'npm'))
    assert(isValidSpecifier('npm:@scope/pkg@1.0.0/sub', 'npm'))
    assert(isValidSpecifier('https://esm.sh/canvas-confetti@1.9.3', 'https'))
    assert(!isValidSpecifier('jsr:@std/assert; rm -rf /', 'jsr'))
    assert(!isValidSpecifier('https://esm.sh/x y', 'https'))
})

// --- resolveWithDeno (integration with Deno resolution) -------------------

Deno.test('resolveWithDeno - npm: resolves to a filesystem path', async () => {
    const id = await resolveWithDeno('npm:vite@^8', 'npm')
    assert(id.includes('vite'), `expected a vite path, got ${id}`)
    assert(!id.startsWith('npm:'), 'npm: should be resolved away')
    assert(!id.startsWith('file:'), 'should be a plain path, not a file: URL')
})

Deno.test('resolveWithDeno - https: is returned verbatim (loaded by the load hook)', async () => {
    const url = 'https://esm.sh/canvas-confetti@1.9.3'
    assertEquals(await resolveWithDeno(url, 'https'), url)
})

Deno.test('resolveWithDeno - jsr: resolves to its concrete module URL via deno info', async () => {
    const id = await resolveWithDeno('jsr:@std/assert@1', 'jsr')
    assert(
        id.startsWith('https://jsr.io/@std/assert/') || id.includes('assert'),
        `expected a resolved jsr module id, got ${id}`,
    )
    assert(!id.startsWith('jsr:'), 'jsr: should be resolved away')
})

// --- plugin.resolveId ------------------------------------------------------

/** Call the plugin's resolveId hook directly (it takes no `this`). */
function resolveId(source: string): Promise<string> | string | null {
    const hook = denoResolver().resolveId as (
        s: string,
    ) => Promise<string> | null
    return hook(source)
}

Deno.test('resolveId - a local relative import passes through (null)', () => {
    assertEquals(resolveId('./local.ts'), null)
    assertEquals(resolveId('../x/y.ts'), null)
    assertEquals(resolveId('node:fs'), null)
})

Deno.test('resolveId - each scheme resolves to a non-null id', async () => {
    assert(await resolveId('npm:vite@^8'))
    assert(await resolveId('https://esm.sh/canvas-confetti@1.9.3'))
    assert(await resolveId('jsr:@std/assert@1'))
})

Deno.test('resolveId - a malformed specifier is rejected loudly', () => {
    assertThrows(
        () => resolveId('jsr:@std/assert; rm -rf /'),
        Error,
        'malformed',
    )
})

Deno.test('resolveWithDeno - an unresolvable jsr: package throws a clear error', async () => {
    await assertRejects(
        () => resolveWithDeno('jsr:@lockness/definitely-not-real@99', 'jsr'),
        Error,
    )
})

// --- review fix-forward: load remote modules from Deno's cache (S-F7) --------

import {
    denoResolver as _denoResolver,
    loadRemoteModule,
} from '../src/plugins/deno.ts'

Deno.test("loadRemoteModule - reads a jsr-resolved module from Deno's cache (no network fetch)", async () => {
    const url = await resolveWithDeno('jsr:@std/assert@1', 'jsr')
    assert(
        url.startsWith('https://jsr.io/'),
        `expected a jsr.io URL, got ${url}`,
    )
    const source = await loadRemoteModule(url)
    assert(source.length > 0, 'module source read from cache')
    assert(source.includes('export'), 'looks like a real module')
})

Deno.test('load hook - returns null for non-https ids (Vite loads files itself)', () => {
    const load = _denoResolver().load as (id: string) => Promise<string> | null
    assertEquals(load('/some/local/file.ts'), null)
})
