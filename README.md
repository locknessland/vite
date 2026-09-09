# `@lockness/vite`

Deno-native [Vite](https://vite.dev) integration for
[Lockness](https://lockness.land) — a dev-server bridge, a Deno specifier
resolver, and a manifest-aware asset helper. Standalone and opt-in: it takes
your app by injection (`App.fetch()`) and never imports `@lockness/core`, so the
dependency graph stays acyclic.

## What it gives you

- **One dev process** — Vite serves your assets and your SSR pages together (no
  second `css:watch` terminal), with HMR and CSS injection.
- **A hashed-asset build** — one client manifest, resolved at render time by
  `viteAssets()` (with CSP nonce support).
- **Deno specifiers under Vite** — `jsr:` / `npm:` / `https:` imports resolve
  through Deno.

## Quick start

```typescript
// vite.config.ts
import { lockness } from '@lockness/vite'
import app from './main.ts'

export default {
    plugins: lockness({ app }),
}
```

```tsx
// in your layout
import { viteAssets } from '@lockness/vite'

const { html } = await viteAssets('app/client.ts', { nonce })
```

## Documentation

The full guide — installation, configuration (`DEFAULTS`), dev vs production
behaviour, the CSP + nonce recipe, Deno interop notes, the current
standalone-run limitation, and troubleshooting — lives in
[`docs/vite.md`](../../docs/vite.md). A runnable example is in
[`demo/`](./demo/README.md).

## Status

Part of epic [#64](https://github.com/locknessland/lockness-monorepo/issues/64).
The plugins, the asset helper, and an in-process e2e test are shipped; a fully
turnkey standalone `vite build` / `deno task dev` of a Deno-specifier app is a
tracked follow-up (see the guide's _Known limitation_).

## License

MIT
