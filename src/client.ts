// The browser side. The plugin inlines this file (compiled) into the
// `virtual:hmr-toast` module and calls `start` with the options and
// `import.meta.hot`, so it must not import anything.

export type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type Badge = "HMR" | "CSS" | "RELOAD";

export interface ClientOptions {
  position: Position;
  duration: number;
  fullReload: boolean;
  exclude: (string | RegExp)[];
  root: string;
  /** Appended to the toasts' styles, inside their shadow root. */
  css: string;
}

// The parts of Vite's HMR payloads we read.
interface Update {
  type: "js-update" | "css-update";
  path: string;
}
interface UpdatePayload {
  updates: Update[];
}
interface Hot {
  on(event: "vite:beforeUpdate" | "vite:afterUpdate", cb: (payload: UpdatePayload) => void): void;
  on(event: "vite:beforeFullReload", cb: (payload: { triggeredBy?: string }) => void): void;
}

const RELOAD_KEY = "vite-plugin-hmr-toast:reload";
// A stored reload older than this never happened (Vite skips reloads for
// another page's HTML), so the next manual reload shouldn't report it.
const MAX_AGE = 10_000;
const MAX_TOASTS = 3;

// A module URL or absolute file as a root-relative path: "src/App.tsx".
export function relative(file: string, root: string): string {
  let p = file.replace(/[?#].*$/, "").replace(/^\/@fs(?=\/)/, "");
  if (root && p.startsWith(root + "/")) p = p.slice(root.length + 1);
  return p.replace(/^\/+/, "");
}

export function isExcluded(path: string, exclude: (string | RegExp)[]): boolean {
  return exclude.some((e) => (typeof e === "string" ? path.includes(e) : e.test(path)));
}

// Stylesheets imported from JS (and Vue <style> blocks) arrive as
// js-updates, so the path decides too, not only the update's type.
const STYLE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)($|\?)|[?&]type=style\b/;

function isStyle(u: Update): boolean {
  return u.type === "css-update" || STYLE.test(u.path);
}

// What one `vite:afterUpdate` shows, or null when every file is excluded.
export function summarize(updates: Update[], opts: ClientOptions): { badge: Badge; files: string[] } | null {
  const kept = updates.filter((u) => !isExcluded(relative(u.path, opts.root), opts.exclude));
  if (kept.length === 0) return null;
  const files = [...new Set(kept.map((u) => relative(u.path, opts.root)))];
  return { badge: kept.every(isStyle) ? "CSS" : "HMR", files };
}

export function start(opts: ClientOptions, hot: Hot): void {
  // Once per page, even if both the injected script and a manual import run.
  const g = globalThis as { __hmrToast?: boolean };
  if (g.__hmrToast) return;
  g.__hmrToast = true;

  if (opts.fullReload) {
    const saved: { files: string[]; t: number } | null = JSON.parse(take(RELOAD_KEY) ?? "null");
    if (saved && Date.now() - saved.t < MAX_AGE) show("RELOAD", saved.files, opts);
    // The file that caused the reload first, then the ones hot-updated just
    // before it, whose toasts the reload is about to wipe.
    hot.on("vite:beforeFullReload", ({ triggeredBy }) => {
      const file = triggeredBy ? relative(triggeredBy, opts.root) : "";
      if (file && isExcluded(file, opts.exclude)) return;
      const files = [...new Set([...(file ? [file] : []), ...recentFiles()])];
      put(RELOAD_KEY, JSON.stringify({ files, t: Date.now() }));
    });
  }

  // How long the browser took to apply each update.
  const started = new WeakMap<UpdatePayload, number>();
  hot.on("vite:beforeUpdate", (payload) => started.set(payload, performance.now()));
  hot.on("vite:afterUpdate", (payload) => {
    const s = summarize(payload.updates, opts);
    const t0 = started.get(payload);
    if (s) show(s.badge, s.files, opts, t0 === undefined ? undefined : performance.now() - t0);
  });
}

// sessionStorage can throw (blocked storage, sandboxed frames): then the
// toasts that span a reload just don't appear.
function take(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

function put(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
}

const CSS = `
:host {
  all: initial;
  --surface: #ffffff;
  --border: rgb(15 23 42 / 0.09);
  --text: #18181b;
  --muted: #71717a;
  --shadow: 0 1px 2px rgb(15 23 42 / 0.06), 0 8px 24px -6px rgb(15 23 42 / 0.14);
}
@media (prefers-color-scheme: dark) {
  :host {
    --surface: #1d1d20;
    --border: rgb(255 255 255 / 0.09);
    --text: #f4f4f5;
    --muted: #a1a1aa;
    --shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px -6px rgb(0 0 0 / 0.5);
  }
}
.stack {
  position: fixed; z-index: 2147483647; display: flex; gap: 8px; width: 300px; pointer-events: none;
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.top-left { top: 16px; left: 16px; flex-direction: column; }
.top-right { top: 16px; right: 16px; flex-direction: column; }
.bottom-left { bottom: 16px; left: 16px; flex-direction: column-reverse; }
.bottom-right { bottom: 16px; right: 16px; flex-direction: column-reverse; }
.toast {
  display: grid; grid-template-columns: 20px 1fr auto; column-gap: 10px; align-items: center;
  padding: 9px 14px; border-radius: 10px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); box-shadow: var(--shadow);
  transition: opacity 160ms ease-out, transform 160ms ease-out;
}
.toast.enter, .toast.leave { opacity: 0; transform: translateY(6px); }
/* The file's icon, or a dot for a reload without a file. */
.dot { justify-self: center; width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; }
.icon, .icon svg { display: block; width: 20px; height: 20px; }
.line { display: flex; min-width: 0; white-space: nowrap; color: var(--muted); }
.line.plain { color: var(--text); }
/* A long name gives way; "and 2 more updated" stays readable. */
.name { overflow: hidden; text-overflow: ellipsis; font-weight: 500; color: var(--text); }
.rest { flex: none; white-space: pre; }
.time { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) {
  .toast { transition: none; }
}
`;

let stack: HTMLElement | null = null;

// The toasts on screen and not yet leaving, so a burst of updates (an agent
// saving file after file) adds to one toast instead of stacking a new one each.
interface Live {
  el: HTMLElement;
  badge: Badge;
  files: string[];
  timer?: ReturnType<typeof setTimeout>;
}
let live: Live[] = [];

function container({ position, css }: ClientOptions): HTMLElement {
  if (stack?.isConnected) return stack;
  live = []; // its toasts went with the old stack
  const host = document.createElement("vite-hmr-toast");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS + css;
  stack = document.createElement("div");
  stack.className = `stack ${position}`;
  root.append(style, stack);
  document.documentElement.append(host);
  return stack;
}

// One line per toast: "App.tsx updated", "main.ts reloaded the page", or
// "Page reloaded" when Vite didn't say which file.
const AFTER_FILE: Record<Badge, string> = { HMR: "updated", CSS: "updated", RELOAD: "reloaded the page" };

// The icon for each extension, as VS Code's Material Icon Theme picks it.
const ICON_OF: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react_ts",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "react",
  css: "css",
  pcss: "css",
  postcss: "css",
  scss: "sass",
  sass: "sass",
  less: "less",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  html: "html",
  json: "json",
};

function fileIcon(file: string): HTMLElement {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const icon = el("span", "icon");
  icon.innerHTML = ICONS[ICON_OF[ext]] ?? ICONS.document;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

// File icons from Material Icon Theme for VS Code
// (https://github.com/material-extensions/vscode-material-icon-theme), under its license:
//
//   The MIT License (MIT)
//   Copyright (c) 2025 Material Extensions
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction,
//   including without limitation the rights to use, copy, modify, merge, publish, distribute,
//   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or substantial
//   portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
//   NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
//   OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
//   CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
const ICONS: Record<string, string> = {
  typescript:
    '<svg viewBox="0 0 16 16"><path fill="#0288d1" d="M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1"/></svg>',
  react_ts:
    '<svg viewBox="0 0 32 32"><path fill="#0288d1" d="M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6"/><path fill="#0288d1" d="M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2"/><path fill="#0288d1" d="M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z"/><path fill="#0288d1" d="M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369"/></svg>',
  javascript:
    '<svg viewBox="0 0 16 16"><path fill="#ffca28" d="M2 2v12h12V2zm6 6h1v4a1.003 1.003 0 0 1-1 1H7a1.003 1.003 0 0 1-1-1v-1h1v1h1zm3 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1"/></svg>',
  react:
    '<svg viewBox="0 0 32 32"><path fill="#00bcd4" d="M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6"/><path fill="#00bcd4" d="M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2"/><path fill="#00bcd4" d="M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z"/><path fill="#00bcd4" d="M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369"/></svg>',
  css: '<svg viewBox="0 0 32 32"><path fill="#7e57c2" d="M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034"/><path fill="#7e57c2" d="M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/></svg>',
  sass: '<svg viewBox="0 0 32 32"><path fill="#ec407a" d="M27.837 5.673a4.33 4.33 0 0 0-2.293-2.701c-2.362-1.261-6.11-1.298-9.548-.092a26.3 26.3 0 0 0-8.76 4.966c-2.752 2.542-3.438 4.925-3.189 6.194.523 2.668 3.274 4.539 5.485 6.042.418.284.822.559 1.175.816-1.429.76-4.261 2.444-5.088 4.248a3.88 3.88 0 0 0-.118 3.332A2.37 2.37 0 0 0 6.869 29.8a5.6 5.6 0 0 0 1.49.2 6.35 6.35 0 0 0 5.19-2.856 6.74 6.74 0 0 0 .864-5.382 7.3 7.3 0 0 1 2.044-.03 3.92 3.92 0 0 1 2.816 1.311 1.82 1.82 0 0 1 .423 1.262 1.55 1.55 0 0 1-.772 1.05c-.234.14-.586.355-.504.803.036.194.198.633.894.512a2.93 2.93 0 0 0 2.145-2.651 4 4 0 0 0-1.197-2.904 5.94 5.94 0 0 0-4.396-1.626 10.6 10.6 0 0 0-2.672.304 20 20 0 0 0-2.203-1.846c-1.712-1.3-3.33-2.529-3.235-4.26.125-2.263 2.468-4.532 6.964-6.744 4.016-1.976 7.254-2.037 8.944-1.438a2 2 0 0 1 1.204.883 2.77 2.77 0 0 1-.36 2.47 9.71 9.71 0 0 1-7.425 4.304 3.86 3.86 0 0 1-3.238-.757c-.278-.302-.593-.645-1.074-.383q-.565.31-.225 1.189a3.9 3.9 0 0 0 2.407 1.92 11.7 11.7 0 0 0 7.128-.671c3.527-1.35 6.681-5.202 5.756-8.787M11.895 24.475a4 4 0 0 1-.192.468 4.5 4.5 0 0 1-.753 1.081 2.83 2.83 0 0 1-2.533 1.107c-.056-.032-.078-.146-.085-.193a3.28 3.28 0 0 1 1.076-2.284 11.3 11.3 0 0 1 2.644-1.933 3.85 3.85 0 0 1-.157 1.754"/></svg>',
  less: '<svg viewBox="0 0 24 24"><path fill="#0277bd" d="M8 3a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2H3v2h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2v-2H8v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V5h2V3m6 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3z"/></svg>',
  vue: '<svg viewBox="0 0 24 24"><path fill="#41b883" d="M1.791 3.851 12 21.471 22.209 3.936V3.85H18.24l-6.18 10.616L5.906 3.851z"/><path fill="#35495e" d="m5.907 3.851 6.152 10.617L18.24 3.851h-3.723L12.084 8.03 9.66 3.85z"/></svg>',
  svelte:
    '<svg viewBox="0 0 300 300"><path fill="#ff5722" d="M175.94 24.328c-13.037.252-26.009 3.872-37.471 11.174L79.912 72.818a67.13 67.13 0 0 0-30.355 44.906 70.8 70.8 0 0 0 6.959 45.445 67.2 67.2 0 0 0-10.035 25.102 71.54 71.54 0 0 0 12.236 54.156c23.351 33.41 69.468 43.311 102.81 22.07l58.559-37.158a67.36 67.36 0 0 0 30.355-44.906 70.77 70.77 0 0 0-6.982-45.422 67.65 67.65 0 0 0 10.059-25.102 71.63 71.63 0 0 0-12.236-54.156v-.18c-15.324-21.925-40.453-33.727-65.342-33.246zm5.137 28.68a46.5 46.5 0 0 1 36.09 19.969 42.98 42.98 0 0 1 7.365 32.557 45 45 0 0 1-1.393 5.455l-1.123 3.37-2.986-2.247a75.9 75.9 0 0 0-22.902-11.45l-2.244-.651.201-2.246a13.16 13.16 0 0 0-2.379-8.711 13.99 13.99 0 0 0-14.953-5.412 12.8 12.8 0 0 0-3.594 1.572l-58.578 37.25a12.24 12.24 0 0 0-5.502 8.15 13.1 13.1 0 0 0 2.246 9.834 14.03 14.03 0 0 0 14.93 5.569 13.5 13.5 0 0 0 3.594-1.573l22.453-14.234a41.8 41.8 0 0 1 11.898-5.232 46.48 46.48 0 0 1 49.914 18.502 43.02 43.02 0 0 1 7.363 32.557 40.42 40.42 0 0 1-18.254 27.078l-58.58 37.316a43 43 0 0 1-11.898 5.23A46.545 46.545 0 0 1 82.81 227.14a42.98 42.98 0 0 1-7.341-32.557 38 38 0 0 1 1.39-5.41l1.102-3.37 3.008 2.246a75.9 75.9 0 0 0 22.836 11.361l2.244.65-.201 2.247a13.25 13.25 0 0 0 2.447 8.644 14.03 14.03 0 0 0 15.043 5.569 13.1 13.1 0 0 0 3.592-1.573l58.467-37.316a12.17 12.17 0 0 0 5.502-8.173 12.96 12.96 0 0 0-2.246-9.811 14.03 14.03 0 0 0-15.043-5.568 12.8 12.8 0 0 0-3.592 1.57l-22.453 14.258a42.9 42.9 0 0 1-11.877 5.209 46.52 46.52 0 0 1-49.846-18.5 43.02 43.02 0 0 1-7.297-32.557A40.42 40.42 0 0 1 96.798 96.98l58.646-37.316a42.8 42.8 0 0 1 11.811-5.21 46.5 46.5 0 0 1 13.822-1.444z"/></svg>',
  astro:
    '<svg viewBox="0 0 32 32"><path fill="#7c4dff" d="M12.106 25.849c-1.262-1.156-1.63-3.586-1.105-5.346a5.18 5.18 0 0 0 3.484 1.66 9.68 9.68 0 0 0 5.882-.734c.215-.106.413-.247.648-.39a3.5 3.5 0 0 1 .16 1.555 4.26 4.26 0 0 1-1.798 3.021c-.404.3-.832.569-1.25.852a2.613 2.613 0 0 0-1.15 3.372l.048.161a3.4 3.4 0 0 1-1.5-1.285 3.6 3.6 0 0 1-.578-1.962 9 9 0 0 0-.05-1.037c-.114-.831-.504-1.204-1.238-1.225a1.45 1.45 0 0 0-1.507 1.18c-.012.056-.028.112-.046.178M4.901 20a17.75 17.75 0 0 1 7.4-2l2.913-8.38a.765.765 0 0 1 1.527 0L19.7 18a14.24 14.24 0 0 1 7.399 2S20.704 2.877 20.692 2.842C20.51 2.33 20.202 2 19.787 2h-7.619c-.415 0-.71.33-.904.842z"/></svg>',
  html: '<svg viewBox="0 0 32 32"><path fill="#e65100" d="m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z"/></svg>',
  json: '<svg viewBox="0 -960 960 960"><path fill="#f9a825" d="M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z"/></svg>',
  document:
    '<svg viewBox="0 0 24 24"><path fill="#42a5f5" d="M8 16h8v2H8zm0-4h8v2H8zm6-10H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm4 18H6V4h7v5h5z"/></svg>',
};

function el(tag: string, className: string, text = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}

// Files in the update toasts on screen: what changed just before a reload.
export function recentFiles(): string[] {
  return live.filter((t) => t.badge === "HMR" || t.badge === "CSS").flatMap((t) => t.files);
}

// `ms` is how long the update took.
export function show(badge: Badge, files: string[], opts: ClientOptions, ms?: number): void {
  const parent = container(opts);
  // Another update of the same kind joins the toast on screen: newest file
  // first, its time, and the countdown starts over.
  const same = (badge === "HMR" || badge === "CSS") && live.find((t) => t.badge === badge);
  const toast = same || { el: el("div", `toast enter ${badge.toLowerCase()}`), badge, files: [] };
  toast.files = [...new Set([...files, ...toast.files])];
  render(toast, ms);

  if (!same) {
    while (parent.children.length >= MAX_TOASTS) {
      const oldest = parent.firstElementChild;
      live = live.filter((t) => t.el !== oldest);
      oldest?.remove();
    }
    toast.el.setAttribute("role", "status");
    parent.append(toast.el);
    live.push(toast);
    requestAnimationFrame(() => toast.el.classList.remove("enter"));
  }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    live = live.filter((t) => t !== toast);
    toast.el.classList.add("leave");
    setTimeout(() => toast.el.remove(), 150);
  }, opts.duration);
}

function render({ el: toast, badge, files }: Live, ms?: number): void {
  const line = el("span", "line");
  if (files.length > 0) {
    // The file name only; hover for the full paths. A reload names the file
    // that caused it, not the ones updated before it.
    const more = badge === "RELOAD" ? 0 : files.length - 1;
    line.append(el("span", "name", files[0].slice(files[0].lastIndexOf("/") + 1)));
    line.append(el("span", "rest", ` ${more ? `and ${more} more ` : ""}${AFTER_FILE[badge]}`));
    line.title = files.join("\n");
  } else {
    line.className = "line plain";
    line.textContent = "Page reloaded";
  }
  const time = el("span", "time", ms === undefined ? "" : `${Math.round(ms)} ms`);
  toast.replaceChildren(files.length > 0 ? fileIcon(files[0]) : el("span", "dot"), line, time);
}
