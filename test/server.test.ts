// The plugin in a real Vite dev server and build.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";
import hmrToast from "../dist/index.js";

const root = fileURLToPath(new URL("./fixture", import.meta.url));

let server: ViteDevServer;
let url: string;
beforeAll(async () => {
  server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    base: "/sub/",
    server: { port: 0 },
    plugins: [hmrToast({ position: "top-left", exclude: [".stories.", /\.gen\.(ts|js)$/i] })],
  });
  await server.listen();
  url = server.resolvedUrls?.local[0] ?? "";
});
afterAll(() => server.close());

test("injects the client into index.html, under base", async () => {
  const html = await (await fetch(url)).text();
  expect(html).toContain('<script type="module" src="/sub/@id/virtual:hmr-toast"></script>');
});

test("serves the client started with the options", async () => {
  const res = await fetch(new URL("@id/virtual:hmr-toast", url));
  expect(res.status).toBe(200);
  const code = await res.text();
  expect(code).toContain('position: "top-left"');
  expect(code).toContain('exclude: [".stories.", /\\.gen\\.(ts|js)$/i]');
  expect(code).toContain(`root: ${JSON.stringify(root)}`);
  // Vite rewrote import.meta.hot, so the module went through its pipeline.
  expect(code).toContain("import.meta.hot = __vite__createHotContext");
});

test("does nothing in vite build", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "hmr-toast-"));
  try {
    await build({ root, configFile: false, logLevel: "silent", build: { outDir }, plugins: [hmrToast()] });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(html).not.toContain("hmr-toast");
    for (const f of readdirSync(path.join(outDir, "assets"))) {
      expect(readFileSync(path.join(outDir, "assets", f), "utf8")).not.toContain("vite-hmr-toast");
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
