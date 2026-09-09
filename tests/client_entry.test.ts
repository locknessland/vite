/**
 * Tests for the lockness:client-entry virtual module plugin (#109).
 *
 * @module @lockness/vite/tests/client_entry
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import {
    CLIENT_ENTRY_ID,
    clientEntry,
    generateClientEntry,
    RESOLVED_CLIENT_ENTRY_ID,
} from '../src/plugins/client_entry.ts'

Deno.test('generateClientEntry - dev injects the HMR client; prod does not', () => {
    const dev = generateClientEntry({
        isDev: true,
        clientEntry: 'app/client.ts',
        hasUserEntry: false,
    })
    assertStringIncludes(dev, "import '/@vite/client'")
    const prod = generateClientEntry({
        isDev: false,
        clientEntry: 'app/client.ts',
        hasUserEntry: false,
    })
    assert(!prod.includes('/@vite/client'), 'no HMR client in prod')
})

Deno.test('generateClientEntry - re-exports the user entry only when present', () => {
    const withUser = generateClientEntry({
        isDev: false,
        clientEntry: 'app/client.ts',
        hasUserEntry: true,
    })
    assertStringIncludes(withUser, "export * from '/app/client.ts'")
    const without = generateClientEntry({
        isDev: false,
        clientEntry: 'app/client.ts',
        hasUserEntry: false,
    })
    assert(!without.includes('export * from'), 'no re-export when absent')
    assertStringIncludes(without, 'export {}')
})

Deno.test('clientEntry - resolveId maps the virtual id to its \\0 form', () => {
    const plugin = clientEntry()
    const resolveId = plugin.resolveId as (id: string) => string | null
    assertEquals(resolveId(CLIENT_ENTRY_ID), RESOLVED_CLIENT_ENTRY_ID)
    assertEquals(resolveId('some/other/module.ts'), null)
})

Deno.test('clientEntry - load returns generated source for the resolved id, null otherwise', async () => {
    const plugin = clientEntry()
    const load = plugin.load as (id: string) => Promise<string | null>
    assertEquals(await load('not-the-virtual-id'), null)
    const src = await load(RESOLVED_CLIENT_ENTRY_ID)
    assert(src, 'generated source returned')
    // No user app/client.ts in the package cwd, so it degrades to export {}.
    assertStringIncludes(src!, 'export {}')
})
