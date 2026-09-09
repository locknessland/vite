# `@lockness/vite` demo

A minimal Lockness app wired to Vite through `@lockness/vite` (epic #64,
sub-issue #115). It exists to prove the integration end-to-end and to serve as a
copy-paste starting point.

## What it contains

| File                                 | Role                                                                      |
| :----------------------------------- | :------------------------------------------------------------------------ |
| `main.ts`                            | Boots `DemoKernel` into an `App`; default-exports it for the Vite config. |
| `kernel.ts`                          | The smallest possible `@Kernel` — one controller, no DB/session/devtools. |
| `app/controller/home_controller.tsx` | Renders the SSR home page; calls `viteAssets()` for the asset tags.       |
| `app/view/home.tsx`                  | The JSX page, server-rendered through `@lockness/core`.                   |
| `app/client.ts`                      | The client entry (imports the CSS); Vite bundles it in production.        |
| `app/view/assets/app.css`            | The Tailwind entry (`DEFAULTS.cssInput`).                                 |
| `vite.config.ts`                     | `plugins: lockness({ app })` — the whole integration in one call.         |

## Automated proof (runs in CI)

The deterministic, browser-free proof lives in
`packages/vite/tests/e2e_smoke_test.ts` and runs with the normal suite:

```bash
deno test -A packages/vite/tests/e2e_smoke_test.ts
```

It asserts, in-process:

- **Dev SSR** — `App.fetch('/')` renders the JSX home page through
  `@lockness/core`, and the dev bridge forwards a non-asset request while never
  forwarding a Vite-internal one.
- **Production asset resolution** — `viteAssets('app/client.ts')` resolves the
  entry to hashed JS + CSS URLs from a built-shape manifest, with the CSP nonce
  on every tag and no dev-server origin leaking (S-F5).

## Runnable steps

Run from **this** directory:

```bash
deno task dev     # dev server: serves SSR pages + assets on http://localhost:5173
deno task build   # production build: emits public/assets/.vite/manifest.json
```

Both tasks pass `--configLoader native` (#154): it loads `vite.config.ts`
through Deno's own runtime instead of Vite 8's esbuild pre-bundle, so the
config's bare `@lockness/*` specifiers and the `@lockness/core` JSX runtime
resolve via Deno. Without it the config fails to load (esbuild emits
`react/jsx-runtime` and treats `@lockness/*` as external). The dev bridge sets
`appType: 'custom'` so Vite yields every non-asset request to `App.fetch()`
rather than answering `/` with its own HTML fallback.

> **CSS.** `vite build` compiles Tailwind **utilities** into the hashed CSS
> under `public/assets/` (the demo's `<main>` uses `flex`/`gap-4` to prove it);
> the same `@tailwindcss/cli` engine backs both the dev watcher and the build.
