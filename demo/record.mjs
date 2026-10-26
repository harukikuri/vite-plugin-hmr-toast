// Records the README's GIF: edits this app's files the way you (or an agent)
// would, while a headless browser films the page, then turns the video into
// ../docs/demo.gif with ffmpeg. Run `pnpm build` at the root first.
//
//   pnpm --filter hmr-toast-demo record
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, "../docs/demo.gif");
const videos = mkdtempSync(path.join(tmpdir(), "hmr-toast-demo-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Every file the script touches, put back as it was at the end.
const saved = new Map();
function edit(file, from, to) {
  const p = path.join(root, "src", file);
  const text = readFileSync(p, "utf8");
  if (!saved.has(p)) saved.set(p, text);
  writeFileSync(p, text.replace(from, to));
}

const serve = async () => {
  const s = await createServer({ root, logLevel: "silent", server: { port: 5577, strictPort: true } });
  await s.listen();
  return s;
};

// The app is on screen (after a reload too: React renders after "load").
const ready = (page) => page.waitForSelector("h1");

// What's happening, in a bar across the top of the page.
const caption = (page, text) =>
  page.evaluate((text) => {
    let bar = document.getElementById("demo-caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "demo-caption";
      bar.style.cssText =
        "position:fixed;left:0;right:0;top:0;padding:10px 32px;font:13px/1.4 ui-monospace,Menlo,monospace;" +
        "color:#e4e4e7;background:#18181b";
      document.body.append(bar);
      document.body.style.paddingTop = "38px";
    }
    bar.textContent = text;
  }, text);

const server = await serve();
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 960, height: 540 },
  recordVideo: { dir: videos, size: { width: 960, height: 540 } },
});
const page = await context.newPage();
const recording = Date.now();
let start = 0; // seconds of blank page at the start of the video, cut from the GIF
try {
  await page.goto("http://localhost:5577/");
  await ready(page);
  start = (Date.now() - recording) / 1000;
  await caption(page, "$ vite");
  await wait(1500);

  await caption(page, "Edit src/App.jsx: the heading");
  edit("App.jsx", "Good morning", "Good morning, Ada");
  await wait(2800);

  await caption(page, "Edit src/App.css: the button color");
  edit("App.css", "background: #18181b;\n  color: #fff;", "background: #4f46e5;\n  color: #fff;");
  await wait(2800);

  await caption(page, "An agent edits three components at once");
  edit("Stats.jsx", "$48.2k", "$51.9k");
  await wait(150);
  edit("Header.jsx", "Reports · Settings", "Reports · Team · Settings");
  await wait(150);
  edit("App.jsx", "New report", "Create report");
  await wait(3000);

  await caption(page, "Edit src/main.jsx: nothing accepts it, so the page reloads");
  edit("main.jsx", 'import "./App.css";', 'import "./App.css";\n\nconsole.log("ready");');
  await page.waitForEvent("load");
  await ready(page);
  await caption(page, "Edit src/main.jsx: nothing accepts it, so the page reloads");
  await wait(2800);
} finally {
  for (const [p, text] of saved) writeFileSync(p, text);
  await context.close(); // finishes the video
  await browser.close();
  await server.close();
}

// A palette made from the video itself keeps the GIF small and the colors right.
const video = path.join(
  videos,
  readdirSync(videos).find((f) => f.endsWith(".webm")),
);
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-ss",
  String(start),
  "-i",
  video,
  "-vf",
  "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none",
  out,
]);
rmSync(videos, { recursive: true, force: true });
console.log(`wrote ${path.relative(process.cwd(), out)}`);
