// The README's manual import type-checks with the shipped declaration,
// resolved the way an app resolves it: from node_modules.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const dir = fileURLToPath(new URL("./types", import.meta.url));
const repo = fileURLToPath(new URL("..", import.meta.url));

test("virtual:hmr-toast type-checks with the reference", () => {
  rmSync(`${dir}/node_modules`, { recursive: true, force: true });
  mkdirSync(`${dir}/node_modules`);
  symlinkSync(repo, `${dir}/node_modules/vite-plugin-hmr-toast`, "dir");
  expect(() => execFileSync("tsc", ["-p", dir], { stdio: "pipe" })).not.toThrow();
});
