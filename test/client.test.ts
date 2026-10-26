// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { type ClientOptions, isExcluded, relative, start, summarize } from "../dist/client.js";

const opts: ClientOptions = {
  position: "bottom-right",
  duration: 1600,
  fullReload: true,
  exclude: [".stories.", /\.generated\./],
  root: "/app",
};

// Stands in for import.meta.hot: records listeners so tests can fire events.
function fakeHot() {
  const listeners: Record<string, (payload: never) => void> = {};
  return {
    on: (event: string, cb: (payload: never) => void) => (listeners[event] = cb),
    emit: (event: string, payload: unknown) => listeners[event]?.(payload as never),
  };
}

function toasts() {
  const host = document.querySelector("vite-hmr-toast");
  return [...(host?.shadowRoot?.querySelectorAll(".toast") ?? [])].map((t) => t.textContent);
}

afterEach(() => {
  document.querySelector("vite-hmr-toast")?.remove();
  delete (globalThis as { __hmrToast?: boolean }).__hmrToast;
  sessionStorage.clear();
  vi.useRealTimers();
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
    expect(toasts()).toEqual(["HMRsrc/App.tsx +1"]);
    vi.advanceTimersByTime(opts.duration + 200);
    expect(toasts()).toEqual([]);
  });

  test("keeps at most three toasts", () => {
    const hot = fakeHot();
    start(opts, hot);
    for (const f of ["a", "b", "c", "d"])
      hot.emit("vite:afterUpdate", { updates: [{ type: "css-update", path: `/${f}.css` }] });
    expect(toasts()).toEqual(["CSSb.css", "CSSc.css", "CSSd.css"]);
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
    expect(toasts()).toEqual(["RELOADsrc/main.ts"]);
    expect(sessionStorage.length).toBe(0);
  });

  test("without a file", () => {
    reloadWith({});
    expect(toasts()).toEqual(["RELOADpage reloaded"]);
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
