# vite-plugin-hmr-toast

A tiny Vite plugin that tells you **what just got hot-updated** — right in the browser.

Ever saved a file and wondered "did that actually apply, or did the page just reload?"
This shows a small toast for every update:

| Badge | When |
| --- | --- |
| `HMR` | JS modules were hot-swapped |
| `CSS` | Only stylesheets changed |
| `RELOAD` | Vite did a full page reload (shown after the page comes back, with the file that caused it) |
| `OFFLINE` | The dev server stopped (stays until it's back) |
| `ONLINE` | The dev server is back (shown after Vite reloads the page) |

`HMR` and `CSS` toasts also show how long the browser took to apply the update: `src/App.tsx · 12ms`.

- Zero config, zero runtime dependencies (~3 kB gzipped client)
- Dev-only: does nothing in `vite build`
- Rendered in Shadow DOM, so it never clashes with your app's CSS
- Respects `prefers-reduced-motion`

## Install

```sh
pnpm add -D vite-plugin-hmr-toast
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import hmrToast from 'vite-plugin-hmr-toast'

export default defineConfig({
  plugins: [hmrToast()],
})
```

## Options

```ts
hmrToast({
  position: 'bottom-right', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  duration: 1600,           // ms
  fullReload: true,         // also report full page reloads
  exclude: ['.stories.', /\.generated\./], // stay quiet for these paths
})
```

`exclude` strings match as substrings; RegExps are tested against the path (e.g. `src/App.tsx`).

## Apps without `index.html`

The client is injected through `transformIndexHtml`. If your setup doesn't go through it
(SSR frameworks, backend integrations), import it yourself from client code:

```ts
if (import.meta.env.DEV) import('virtual:hmr-toast')
```

In TypeScript, reference the module's types once (e.g. in `src/vite-env.d.ts`):

```ts
/// <reference types="vite-plugin-hmr-toast/virtual" />
```

## How it works

The plugin serves a virtual module that listens to Vite's built-in HMR events
(`vite:beforeUpdate`, `vite:afterUpdate`, `vite:beforeFullReload` and `vite:ws:disconnect`).
Full reloads and server restarts are remembered in `sessionStorage` for one hop so the
toast can survive the reload.

## Development

```sh
pnpm install
pnpm play   # build + start the playground, then edit files in playground/
pnpm test   # build + vitest (unit, dev-server and DOM tests)
```

To release, bump the version and push the tag; GitHub Actions tests it on Vite 5–8,
publishes to npm (trusted publishing, with provenance) and creates the GitHub release:

```sh
npm version minor   # or patch / major: commits and tags v0.3.0
git push --follow-tags
```

## License

MIT
