/**
 * Tests for defineViteConfig() and DEFAULTS (#107).
 *
 * @module @lockness/vite/tests/define_config
 */

import { assertEquals, assertNotStrictEquals } from '@std/assert'
import { defineViteConfig } from '../src/define_config.ts'
import { DEFAULTS } from '../src/shared.ts'

Deno.test('defineViteConfig - no args returns all DEFAULTS', () => {
    assertEquals(defineViteConfig(), DEFAULTS)
})

Deno.test('defineViteConfig - a partial config overrides only the provided keys', () => {
    // Keys unrelated to the port/devServerUrl pair (which is reconciled below).
    const result = defineViteConfig({ outDir: 'dist', cssInput: 'x.css' })
    assertEquals(result.outDir, 'dist')
    assertEquals(result.cssInput, 'x.css')
    // Every other key stays at its DEFAULTS value.
    assertEquals(result.serverEntry, DEFAULTS.serverEntry)
    assertEquals(result.clientEntry, DEFAULTS.clientEntry)
    assertEquals(result.manifestPath, DEFAULTS.manifestPath)
    assertEquals(result.devServerUrl, DEFAULTS.devServerUrl)
    assertEquals(result.port, DEFAULTS.port)
    assertEquals(result.routeDir, DEFAULTS.routeDir)
})

Deno.test('defineViteConfig - overriding port alone derives devServerUrl (no desync)', () => {
    const result = defineViteConfig({ port: 3000 })
    assertEquals(result.port, 3000)
    assertEquals(result.devServerUrl, 'http://localhost:3000')
})

Deno.test('defineViteConfig - overriding devServerUrl alone derives the port', () => {
    const result = defineViteConfig({ devServerUrl: 'http://localhost:4000' })
    assertEquals(result.devServerUrl, 'http://localhost:4000')
    assertEquals(result.port, 4000)
})

Deno.test('defineViteConfig - overriding both takes each as given', () => {
    const result = defineViteConfig({
        port: 3000,
        devServerUrl: 'http://127.0.0.1:8080',
    })
    assertEquals(result.port, 3000)
    assertEquals(result.devServerUrl, 'http://127.0.0.1:8080')
})

Deno.test('defineViteConfig - a devServerUrl without an explicit port leaves port at default', () => {
    const result = defineViteConfig({ devServerUrl: 'http://localhost' })
    assertEquals(result.devServerUrl, 'http://localhost')
    assertEquals(result.port, DEFAULTS.port)
})

Deno.test('defineViteConfig - does not mutate DEFAULTS', () => {
    const before = { ...DEFAULTS }
    const result = defineViteConfig({ port: 9999 })
    assertNotStrictEquals(result, DEFAULTS)
    assertEquals(DEFAULTS, before)
})

Deno.test('DEFAULTS - manifestPath sits under outDir', () => {
    // The manifest lives inside the asset output tree (plan invariant).
    assertEquals(DEFAULTS.manifestPath.startsWith(DEFAULTS.outDir + '/'), true)
})

Deno.test('defineViteConfig - explicit undefined keeps the default (Required<> intact)', () => {
    const result = defineViteConfig({ port: undefined, outDir: undefined })
    assertEquals(result.port, DEFAULTS.port)
    assertEquals(result.outDir, DEFAULTS.outDir)
})
