# vite-plugin-hmr-toast

Shows a toast in the browser whenever Vite hot-updates a file or reloads the page. It only runs
in `vite dev`.

![Toasts for a hot update, a style update, an agent editing three files, and a page reload](https://raw.githubusercontent.com/harukikuri/vite-plugin-hmr-toast/main/docs/demo.gif)

Saves that land close together, like an agent editing several files, share one toast. Hover a
toast to see the full paths.

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
  css: '',                  // your own CSS for the toasts, see below
})
```

`exclude` strings match as substrings; RegExps are tested against the path (e.g. `src/App.tsx`).

## Styling

The toasts render in a shadow root, so your app's CSS doesn't reach them. Pass `css` instead.
It goes in after the built-in styles, so the same selectors win:

```ts
hmrToast({
  css: `
    :host { --surface: #111; --text: #eee; --muted: #999; --border: #333; }
    .toast { border-radius: 4px; font-family: Inter, sans-serif; }
  `,
})
```

Colors are variables on `:host`: `--surface`, `--border`, `--text`, `--muted` and `--shadow`.
Values you set apply in light and dark mode alike; for separate dark ones, set them again
under `@media (prefers-color-scheme: dark)`.

The elements are `.toast` (also `.hmr`, `.css` or `.reload`), and inside it `.icon` (or `.dot`
for a reload without a file), `.line` with `.name` for the file name, and `.time`.

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

## Development

```sh
pnpm install
pnpm play   # build + start the playground, then edit files in playground/
pnpm test   # build + vitest (unit, dev-server and DOM tests)
pnpm build && pnpm --filter hmr-toast-demo record   # re-record docs/demo.gif (needs ffmpeg)
```

To release, bump the version and push the tag; GitHub Actions tests it on Vite 5–8,
publishes to npm (trusted publishing, with provenance) and creates the GitHub release:

```sh
npm version minor   # or patch / major: commits and tags v0.3.0
git push --follow-tags
```

## License

MIT. The file icons come from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) (MIT).
