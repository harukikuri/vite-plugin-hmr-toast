// vite-plugin-hmr-toast: serves `virtual:hmr-toast` (the client in
// client.ts, started with these options) and injects it into index.html.
// In `vite build` the module is empty and nothing is injected.
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import type { Position } from "./client.ts";

export interface HmrToastOptions {
  position?: Position;
  duration?: number;
  fullReload?: boolean;
  /** Paths to stay quiet for: strings match as substrings, RegExps are tested. */
  exclude?: (string | RegExp)[];
  /** Your own CSS for the toasts, added after theirs inside their shadow root. */
  css?: string;
}

const VIRTUAL = "virtual:hmr-toast";
const RESOLVED = "\0" + VIRTUAL;
// Compiled next to this file in dist/.
const clientFile = new URL("./client.js", import.meta.url);

export default function hmrToast(options: HmrToastOptions = {}): Plugin {
  const { position = "bottom-right", duration = 1600, fullReload = true, exclude = [], css = "" } = options;
  let serve = false;
  let root = "";
  let base = "/";

  return {
    name: "vite-plugin-hmr-toast",
    configResolved(config) {
      serve = config.command === "serve";
      root = config.root;
      base = config.base;
    },
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED;
    },
    load(id) {
      if (id !== RESOLVED) return;
      if (!serve) return "export {};";
      // RegExps as literals, so they survive the trip to the browser.
      const patterns = exclude.map((e) => (typeof e === "string" ? JSON.stringify(e) : String(e))).join(", ");
      const opts = `{ position: ${JSON.stringify(position)}, duration: ${JSON.stringify(duration)}, fullReload: ${JSON.stringify(fullReload)}, exclude: [${patterns}], root: ${JSON.stringify(root)}, css: ${JSON.stringify(css)} }`;
      return `${readFileSync(clientFile, "utf8")}\nif (import.meta.hot) start(${opts}, import.meta.hot);\n`;
    },
    transformIndexHtml() {
      if (!serve) return;
      return [{ tag: "script", attrs: { type: "module", src: `${base}@id/${VIRTUAL}` }, injectTo: "head" }];
    },
  };
}
