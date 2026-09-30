import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const seed = spawnSync(process.execPath, [require.resolve("tsx/cli"), join(root, "scripts/seed-tui-session.ts")], {
  cwd: root, encoding: "utf8", env: { ...process.env, PI_OFFLINE: "1" },
});
if (seed.error) throw seed.error;
if (seed.status !== 0) { process.stderr.write(seed.stderr); process.exit(seed.status ?? 1); }
const session = JSON.parse(seed.stdout);
const resultsDir = mkdtempSync(join(tmpdir(), "pi-compact-tui-results-"));
writeFileSync(join(resultsDir, "session.json"), JSON.stringify(session, null, 2) + "\n");
const log = join(resultsDir, "fullscreen.ansi.log");
const result = spawnSync("expect", [join(root, "scripts/tui-smoke.exp"), session.cwd, session.agentDir, session.session, join(root, "index.ts"), log], {
  cwd: root, stdio: "inherit",
});
console.log(`TUI log: ${log}`);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
