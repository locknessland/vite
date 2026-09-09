/**
 * Tests for the shared kernel — the classifyChange glob arbiter (#111/#112).
 *
 * @module @lockness/vite/tests/shared
 */

import { assertEquals } from '@std/assert'
import { classifyChange } from '../src/shared.ts'

Deno.test('classifyChange - server-reload globs win over CSS on overlap', () => {
    // A .tsx under app/controller/ matches BOTH sets → server-reload wins.
    assertEquals(classifyChange('app/controller/home.tsx'), 'server-reload')
    assertEquals(classifyChange('app/service/user.ts'), 'server-reload')
    assertEquals(classifyChange('app/middleware/auth.ts'), 'server-reload')
    assertEquals(classifyChange('app/routes.ts'), 'server-reload')
    assertEquals(classifyChange('config/app.ts'), 'server-reload')
})

Deno.test('classifyChange - a view .tsx is a CSS rebuild', () => {
    assertEquals(classifyChange('app/view/components/card.tsx'), 'css')
    assertEquals(classifyChange('./app/view/pages/home.tsx'), 'css')
})

Deno.test('classifyChange - unrelated paths are ignored', () => {
    assertEquals(classifyChange('README.md'), 'ignore')
    assertEquals(classifyChange('packages/core/mod.ts'), 'ignore')
    assertEquals(classifyChange('app/view/assets/app.css'), 'ignore')
})
