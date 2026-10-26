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
}

// The parts of Vite's HMR payloads we read.
interface Update {
  type: "js-update" | "css-update";
  path: string;
}
interface Hot {
  on(event: "vite:afterUpdate", cb: (payload: { updates: Update[] }) => void): void;
  on(event: "vite:beforeFullReload", cb: (payload: { triggeredBy?: string }) => void): void;
}

const KEY = "vite-plugin-hmr-toast:reload";
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
    const saved = takeReload();
    if (saved && Date.now() - saved.t < MAX_AGE) show("RELOAD", saved.file ? [saved.file] : [], opts);
    hot.on("vite:beforeFullReload", ({ triggeredBy }) => {
      const file = triggeredBy ? relative(triggeredBy, opts.root) : "";
      if (file && isExcluded(file, opts.exclude)) return;
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ file, t: Date.now() }));
      } catch {}
    });
  }

  hot.on("vite:afterUpdate", ({ updates }) => {
    const s = summarize(updates, opts);
    if (s) show(s.badge, s.files, opts);
  });
}

function takeReload(): { file: string; t: number } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const CSS = `
:host { all: initial; }
.stack {
  position: fixed; z-index: 2147483647; display: flex; gap: 6px; pointer-events: none;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.top-left { top: 12px; left: 12px; flex-direction: column; }
.top-right { top: 12px; right: 12px; flex-direction: column; align-items: flex-end; }
.bottom-left { bottom: 12px; left: 12px; flex-direction: column-reverse; }
.bottom-right { bottom: 12px; right: 12px; flex-direction: column-reverse; align-items: flex-end; }
.toast {
  display: flex; align-items: center; gap: 8px; max-width: 360px; padding: 6px 10px;
  border-radius: 6px; background: #1b1b1f; color: #e8e8ea; box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
  transition: opacity 150ms, transform 150ms;
}
.toast.enter, .toast.leave { opacity: 0; transform: translateY(4px); }
.badge { padding: 1px 6px; border-radius: 4px; font-weight: 700; color: #111; }
.HMR { background: #4ade80; }
.CSS { background: #60a5fa; }
.RELOAD { background: #fbbf24; }
.file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;

let stack: HTMLElement | null = null;

function container(position: Position): HTMLElement {
  if (stack?.isConnected) return stack;
  const host = document.createElement("vite-hmr-toast");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  stack = document.createElement("div");
  stack.className = `stack ${position}`;
  root.append(style, stack);
  document.documentElement.append(host);
  return stack;
}

export function show(badge: Badge, files: string[], opts: ClientOptions): void {
  const parent = container(opts.position);
  while (parent.children.length >= MAX_TOASTS) parent.firstElementChild?.remove();

  const toast = document.createElement("div");
  toast.className = "toast enter";
  toast.setAttribute("role", "status");
  const label = document.createElement("span");
  label.className = `badge ${badge}`;
  label.textContent = badge;
  const text = document.createElement("span");
  text.className = "file";
  text.textContent =
    files.length === 0 ? "page reloaded" : files[0] + (files.length > 1 ? ` +${files.length - 1}` : "");
  text.title = files.join("\n");
  toast.append(label, text);
  parent.append(toast);

  requestAnimationFrame(() => toast.classList.remove("enter"));
  setTimeout(() => {
    toast.classList.add("leave");
    setTimeout(() => toast.remove(), 150);
  }, opts.duration);
}
