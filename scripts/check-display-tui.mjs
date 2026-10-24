import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const seed = spawnSync(process.execPath, [require.resolve("tsx/cli"), join(root, "scripts/seed-display-session.ts")], { cwd: root, encoding: "utf8", env: { ...process.env, PI_OFFLINE: "1" } });
if (seed.error) throw seed.error;
if (seed.status !== 0) { process.stderr.write(seed.stderr); process.exit(seed.status ?? 1); }
const session = JSON.parse(seed.stdout);
const resultsDir = mkdtempSync(join(tmpdir(), "pi-compact-display-results-"));
writeFileSync(join(resultsDir, "session.json"), JSON.stringify(session, null, 2) + "\n");
const log = join(resultsDir, "fullscreen.ansi.log");
const result = spawnSync("expect", [join(root, "scripts/display-preferences-smoke.exp"), session.cwd, session.agentDir, session.session, join(root, "index.ts"), log, ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
console.log(`Display TUI results: ${resultsDir}`);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
