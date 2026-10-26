// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { type ClientOptions, isExcluded, relative, show, start, summarize } from "../dist/client.js";

const opts: ClientOptions = {
  position: "bottom-right",
  duration: 1600,
  fullReload: true,
  exclude: [".stories.", /\.generated\./],
  root: "/app",
  css: "",
};

// Stands in for import.meta.hot: records listeners so tests can fire events.
function fakeHot() {
  const listeners: Record<string, (payload: never) => void> = {};
  return {
    on: (event: string, cb: (payload: never) => void) => (listeners[event] = cb),
    emit: (event: string, payload: unknown) => listeners[event]?.(payload as never),
  };
}

// Each toast's line, with its time when it has one: "App.tsx updated (12 ms)".
function toasts() {
  const host = document.querySelector("vite-hmr-toast");
  return [...(host?.shadowRoot?.querySelectorAll(".toast") ?? [])].map((t) => {
    const time = t.querySelector(".time")?.textContent;
    return (t.querySelector(".line")?.textContent ?? "") + (time ? ` (${time})` : "");
  });
}

afterEach(() => {
  document.querySelector("vite-hmr-toast")?.remove();
  delete (globalThis as { __hmrToast?: boolean }).__hmrToast;
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("paths", () => {
  test("relative", () => {
    expect(relative("/src/App.tsx?t=123", "/app")).toBe("src/App.tsx");
    expect(relative("/app/src/App.tsx", "/app")).toBe("src/App.tsx");
    expect(relative("/@fs/app/src/a.ts", "/app")).toBe("src/a.ts");
    expect(relative("/@fs/other/a.ts", "/app")).toBe("other/a.ts");
  });

  test("isExcluded", () => {
    expect(isExcluded("src/Button.stories.tsx", opts.exclude)).toBe(true);
    expect(isExcluded("src/api.generated.ts", opts.exclude)).toBe(true);
    expect(isExcluded("src/App.tsx", opts.exclude)).toBe(false);
  });
});

describe("summarize", () => {
  test("CSS only when every update is CSS", () => {
    expect(summarize([{ type: "css-update", path: "/src/a.css" }], opts)).toEqual({
      badge: "CSS",
      files: ["src/a.css"],
    });
    expect(
      summarize(
        [
          { type: "css-update", path: "/src/a.css" },
          { type: "js-update", path: "/src/App.tsx" },
        ],
        opts,
      )?.badge,
    ).toBe("HMR");
  });

  test("stylesheets imported from JS count as CSS", () => {
    expect(summarize([{ type: "js-update", path: "/src/a.module.scss" }], opts)?.badge).toBe("CSS");
    expect(summarize([{ type: "js-update", path: "/src/App.vue?vue&type=style&index=0" }], opts)?.badge).toBe("CSS");
    expect(summarize([{ type: "js-update", path: "/src/App.vue" }], opts)?.badge).toBe("HMR");
  });

  test("dedupes files and drops excluded ones", () => {
    const s = summarize(
      [
        { type: "js-update", path: "/src/App.tsx?t=1" },
        { type: "js-update", path: "/src/App.tsx?t=2" },
        { type: "js-update", path: "/src/x.generated.ts" },
      ],
      opts,
    );
    expect(s).toEqual({ badge: "HMR", files: ["src/App.tsx"] });
    expect(summarize([{ type: "js-update", path: "/src/x.generated.ts" }], opts)).toBeNull();
  });
});

describe("toasts", () => {
  test("shows an update and removes it after the duration", () => {
    vi.useFakeTimers();
    const hot = fakeHot();
    start(opts, hot);
    hot.emit("vite:afterUpdate", {
      updates: [
        { type: "js-update", path: "/src/App.tsx" },
        { type: "js-update", path: "/src/b.ts" },
      ],
    });
    expect(toasts()).toEqual(["App.tsx and 1 more updated"]);
    vi.advanceTimersByTime(opts.duration + 200);
    expect(toasts()).toEqual([]);
  });

  test("shows the file's icon, or a dot without a file", () => {
    show("HMR", ["src/App.tsx"], opts);
    show("RELOAD", ["src/Makefile"], opts);
    show("RELOAD", [], opts);
    // Each icon told apart by its viewBox and color.
    const icons = [...(document.querySelector("vite-hmr-toast")?.shadowRoot?.querySelectorAll(".toast") ?? [])].map(
      (t) => {
        const svg = t.firstElementChild?.querySelector("svg");
        return `${t.firstElementChild?.className} ${svg?.getAttribute("viewBox")} ${svg?.querySelector("path")?.getAttribute("fill")}`;
      },
    );
    expect(icons).toEqual(["icon 0 0 32 32 #0288d1", "icon 0 0 24 24 #42a5f5", "dot undefined undefined"]);
  });

  test("adds the css option after its own styles", () => {
    show("HMR", ["src/a.ts"], { ...opts, css: ".toast { border-radius: 0; }" });
    const style = document.querySelector("vite-hmr-toast")?.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(style.endsWith(".toast { border-radius: 0; }")).toBe(true);
    expect(style.indexOf(".toast {")).toBeLessThan(style.lastIndexOf(".toast {"));
  });

  test("keeps at most three toasts", () => {
    show("RELOAD", [], opts);
    show("RELOAD", ["src/main.ts"], opts);
    show("CSS", ["src/a.css"], opts);
    show("HMR", ["src/a.ts"], opts);
    expect(toasts()).toEqual(["main.ts reloaded the page", "a.css updated", "a.ts updated"]);
  });

  test("starts once per page", () => {
    const hot = fakeHot();
    start(opts, hot);
    const second = fakeHot();
    start(opts, second);
    second.emit("vite:afterUpdate", { updates: [{ type: "js-update", path: "/a.ts" }] });
    expect(toasts()).toEqual([]);
  });
});

describe("bursts of updates", () => {
  const update = (hot: ReturnType<typeof fakeHot>, type: string, path: string) =>
    hot.emit("vite:afterUpdate", { updates: [{ type, path }] });

  test("updates of the same kind join one toast, newest file first", () => {
    const hot = fakeHot();
    start(opts, hot);
    update(hot, "js-update", "/src/a.ts");
    update(hot, "js-update", "/src/b.ts");
    update(hot, "js-update", "/src/a.ts?t=2");
    expect(toasts()).toEqual(["a.ts and 1 more updated"]);
  });

  test("hot updates and style updates stay apart", () => {
    const hot = fakeHot();
    start(opts, hot);
    update(hot, "js-update", "/src/a.ts");
    update(hot, "css-update", "/src/a.css");
    update(hot, "js-update", "/src/b.ts");
    expect(toasts()).toEqual(["b.ts and 1 more updated", "a.css updated"]);
  });

  test("each update restarts the countdown", () => {
    vi.useFakeTimers();
    const hot = fakeHot();
    start(opts, hot);
    update(hot, "js-update", "/src/a.ts");
    vi.advanceTimersByTime(opts.duration - 100);
    update(hot, "js-update", "/src/b.ts");
    vi.advanceTimersByTime(opts.duration - 100);
    expect(toasts()).toEqual(["b.ts and 1 more updated"]);
    vi.advanceTimersByTime(300);
    expect(toasts()).toEqual([]);
    // Once it's gone, the next update starts a new toast.
    update(hot, "js-update", "/src/c.ts");
    expect(toasts()).toEqual(["c.ts updated"]);
  });
});

describe("update time", () => {
  test("from vite:beforeUpdate to vite:afterUpdate", () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(112.4);
    const hot = fakeHot();
    start(opts, hot);
    const payload = { updates: [{ type: "js-update", path: "/src/App.tsx" }] };
    hot.emit("vite:beforeUpdate", payload);
    hot.emit("vite:afterUpdate", payload);
    expect(toasts()).toEqual(["App.tsx updated (12 ms)"]);
  });
});

describe("full reload", () => {
  // The page before the reload stores it; the page after shows it.
  function reloadWith(payload: { triggeredBy?: string }, options = opts) {
    const hot = fakeHot();
    start(options, hot);
    hot.emit("vite:beforeFullReload", payload);
    delete (globalThis as { __hmrToast?: boolean }).__hmrToast;
    document.querySelector("vite-hmr-toast")?.remove();
    start(options, fakeHot());
  }

  test("shows the file that caused it after the page comes back", () => {
    reloadWith({ triggeredBy: "/app/src/main.ts" });
    expect(toasts()).toEqual(["main.ts reloaded the page"]);
    expect(sessionStorage.length).toBe(0);
  });

  test("keeps the files hot-updated just before it", () => {
    const hot = fakeHot();
    start(opts, hot);
    hot.emit("vite:afterUpdate", { updates: [{ type: "js-update", path: "/src/counter.ts" }] });
    hot.emit("vite:afterUpdate", { updates: [{ type: "css-update", path: "/src/style.css" }] });
    hot.emit("vite:beforeFullReload", { triggeredBy: "/app/src/main.ts" });
    delete (globalThis as { __hmrToast?: boolean }).__hmrToast;
    document.querySelector("vite-hmr-toast")?.remove();
    start(opts, fakeHot());
    // The cause in the line, every file when you hover it.
    expect(toasts()).toEqual(["main.ts reloaded the page"]);
    const line = document.querySelector("vite-hmr-toast")?.shadowRoot?.querySelector<HTMLElement>(".line");
    expect(line?.title).toBe("src/main.ts\nsrc/counter.ts\nsrc/style.css");
  });

  test("without a file", () => {
    reloadWith({});
    expect(toasts()).toEqual(["Page reloaded"]);
  });

  test("quiet for excluded files", () => {
    reloadWith({ triggeredBy: "/app/src/a.generated.ts" });
    expect(toasts()).toEqual([]);
  });

  test("quiet with fullReload: false", () => {
    reloadWith({ triggeredBy: "/app/src/main.ts" }, { ...opts, fullReload: false });
    expect(toasts()).toEqual([]);
  });

  test("ignores a stored reload that never happened", () => {
    sessionStorage.setItem(
      "vite-plugin-hmr-toast:reload",
      JSON.stringify({ file: "src/a.ts", t: Date.now() - 60_000 }),
    );
    start(opts, fakeHot());
    expect(toasts()).toEqual([]);
  });
});
