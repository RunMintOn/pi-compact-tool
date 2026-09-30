import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { ChangeTracker, MAX_SNAPSHOT_BYTES } from "../src/changes.ts";
import { createDisplayTools } from "../src/tools.ts";
import { renderChangesPage } from "../src/changes-page.ts";

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "pi-changes-"));
  const tracker = new ChangeTracker();
  const ctx = { cwd, sessionManager: SessionManager.inMemory(cwd) } as unknown as ExtensionToolContext;
  const tools = new Map(createDisplayTools(() => ({}), tracker).map(tool => [tool.name, tool]));
  const run = (name: string, args: unknown, signal?: AbortSignal) => tools.get(name)!.execute("test", args, signal, undefined, ctx);
  tracker.start(cwd, 1000);
  tracker.userMessage({ content: [{ type: "text", text: "完整的用户消息\n第二行 <script>window.injected = true</script>" }] });
  return { cwd, tracker, run };
}

test("multiple Edit and Write calls produce a net diff against the existing dirty file, not intermediate states", async () => {
  const { cwd, tracker, run } = await fixture();
  await writeFile(join(cwd, "file.ts"), "const original = 1;\nunchanged\n");
  await writeFile(join(cwd, "unrelated.ts"), "do not read me\n");
  const edit = (oldText: string, newText: string) => run("edit", { path: "file.ts", edits: [{ oldText, newText }] });
  await edit("original = 1", "middle = 2");
  await edit("middle = 2", "final = 3");
  await run("write", { path: "new.ts", content: "new intermediate\n" });
  await run("write", { path: "./new.ts", content: "new file\n" });
  const report = await tracker.finish(2000, "completed");
  assert.equal(report!.files.length, 2);
  const modified = report!.files.find(file => file.path === "file.ts")!;
  assert.equal(modified.status, "Modified");
  assert.equal(modified.added, 1);
  assert.equal(modified.deleted, 1);
  const diff = JSON.stringify(modified.diff);
  assert.match(diff, /const original = 1/);
  assert.match(diff, /const final = 3/);
  assert.doesNotMatch(diff, /middle/);
  const created = report!.files.find(file => file.path === "new.ts")!;
  assert.equal(created.status, "Added");
  assert.doesNotMatch(JSON.stringify(created.diff), /intermediate/);
  assert.equal(report!.added, 2);
  assert.equal(report!.deleted, 1);
  assert.deepEqual(report!.prompts, ["完整的用户消息\n第二行 <script>window.injected = true</script>"]);
  await writeFile(join(cwd, "file.ts"), "later run\n");
  assert.equal(JSON.stringify(modified.diff), diff);
  assert.equal(await tracker.finish(3000, "completed"), undefined);
});

test("Write overwrite captures deletions; restored files and failed edits do not become changes", async () => {
  const { cwd, tracker, run } = await fixture();
  await writeFile(join(cwd, "overwrite.txt"), "one\ntwo\nthree\n");
  await run("write", { path: "overwrite.txt", content: "ONE\nthree\n" });
  await writeFile(join(cwd, "restore.txt"), "original\n");
  await run("write", { path: "restore.txt", content: "temporary\n" });
  await run("write", { path: "restore.txt", content: "original\n" });
  await assert.rejects(run("edit", { path: "missing", edits: [{ oldText: "x", newText: "y" }] }));
  await assert.rejects(run("write", { path: "aborted.txt", content: "x" }, AbortSignal.abort()));
  const report = await tracker.finish(2000, "aborted");
  assert.equal(report!.outcome, "aborted");
  assert.deepEqual(report!.files.map(file => file.path), ["overwrite.txt"]);
  assert.equal(report!.added, 1);
  assert.equal(report!.deleted, 2);
});

test("parallel writes, path aliases and automatic continuations retain one original snapshot", async () => {
  const { cwd, tracker, run } = await fixture();
  await writeFile(join(cwd, "file.txt"), "original\n");
  await symlink(join(cwd, "file.txt"), join(cwd, "alias.txt"));
  await Promise.all([
    run("write", { path: "file.txt", content: "first\n" }),
    run("write", { path: "./file.txt", content: "second\n" }),
  ]);
  tracker.start(cwd, 1500);
  tracker.userMessage({ content: "追加指令，保留全文。" });
  await run("write", { path: "alias.txt", content: "final\n" });
  const report = await tracker.finish(2000, "completed");
  assert.equal(report!.start, 1000);
  assert.equal(report!.files.length, 1);
  assert.match(JSON.stringify(report!.files[0]!.diff), /original/);
  assert.match(JSON.stringify(report!.files[0]!.diff), /final/);
  assert.equal(report!.prompts.length, 2);
});

test("unavailable snapshots stay visible; tracked deletion and empty creation retain their types", async () => {
  const { cwd, tracker, run } = await fixture();
  await writeFile(join(cwd, "binary.bin"), Buffer.from([0, 1, 2]));
  await run("write", { path: "binary.bin", content: "text\n" });
  await writeFile(join(cwd, "big.txt"), "x".repeat(MAX_SNAPSHOT_BYTES + 1));
  await run("write", { path: "big.txt", content: "small\n" });
  await writeFile(join(cwd, "delete.txt"), "old\n");
  await run("write", { path: "delete.txt", content: "temporary\n" });
  await unlink(join(cwd, "delete.txt"));
  await run("write", { path: "empty.txt", content: "" });
  const report = await tracker.finish(2000, "error");
  assert.equal(report!.outcome, "error");
  assert.equal(report!.files.find(file => file.path === "binary.bin")!.status, "Unavailable");
  assert.match(report!.files.find(file => file.path === "big.txt")!.notice!, /1 MiB/);
  assert.equal(report!.files.find(file => file.path === "delete.txt")!.status, "Deleted");
  assert.equal(report!.files.find(file => file.path === "empty.txt")!.status, "Added");
  assert.equal(report!.deleted, 1);
});

test("self-contained report saves full prompts without allowing HTML injection or ambiguous filenames", async () => {
  const { cwd, tracker, run } = await fixture();
  const name = "<odd>\t文件.ts";
  await run("write", { path: name, content: "</script><script>window.injected = true</script>\n" });
  const report = await tracker.finish(2000, "completed");
  assert.equal(report!.files[0]!.path, name);
  assert.equal(report!.added, 1);
  const html = renderChangesPage(report!);
  assert.ok(html.includes('id="report-data"'));
  assert.ok(html.includes("Diff2Html"));
  assert.doesNotMatch(html, /<script>window\.injected/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  const data = JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)![1]!);
  assert.deepEqual(data.prompts, report!.prompts);
  const saved = await tracker.save(report!, join(cwd, "reports"));
  assert.equal(await readFile(saved, "utf8"), html);
});

test("tracking outside a run is a no-op and reset drops only in-memory state", async () => {
  const { cwd, tracker, run } = await fixture();
  tracker.reset();
  await run("write", { path: "normal.txt", content: "normal\n" });
  assert.equal(await tracker.finish(2000, "completed"), undefined);
  tracker.start(cwd, 3000);
  await run("write", { path: "normal.txt", content: "next\n" });
  const report = await tracker.finish(4000, "completed");
  assert.match(JSON.stringify(report!.files[0]!.diff), /normal/);
});
