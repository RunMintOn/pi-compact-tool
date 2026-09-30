import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const files = readdirSync(new URL("../tests/", import.meta.url))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()
  .map((file) => new URL(`../tests/${file}`, import.meta.url).pathname);
const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), "--test", ...files], {
  stdio: "inherit",
  env: { ...process.env, PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), "pi-compact-tests-")), PI_OFFLINE: "1" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
