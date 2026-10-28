import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
import type { ChangeReport } from "../src/changes.ts";
import { createMenuDriver } from "./helpers/menu.ts";

const theme = { appearance: "dark", fg: (_: string, text: string) => text, style: (text: string) => text } as unknown as Theme;

async function emptyDiffText(report: ChangeReport): Promise<string> {
  const element = () => ({
    textContent: "", dataset: {}, clientWidth: 1000,
    append() {}, addEventListener() {}, replaceChildren() {},
    querySelectorAll: () => [], querySelector: () => undefined,
    classList: { toggle() {} },
  });
  const nodes = new Map(["main", "diffs", "file-list", "files-toggle", "outcome", "metadata", "file-count", "prompts", "wrap-lines", "position", "prev-change", "next-change"]
    .map(id => [id, element()]));
  nodes.set("report-data", { ...element(), textContent: JSON.stringify(report) });
  runInNewContext(await readFile(new URL("../src/changes-page.js", import.meta.url), "utf8"), {
    document: {
      getElementById: (id: string) => nodes.get(id),
      querySelector: element, querySelectorAll: () => [],
      createElement: element, addEventListener() {},
    },
    window: { addEventListener() {}, scrollY: 0, innerHeight: 800, scrollTo() {}, matchMedia: () => ({ matches: false }) },
    performance: { now: () => 0 },
    requestAnimationFrame: () => {},
    ResizeObserver: class { observe() {} },
  });
  return nodes.get("diffs")!.textContent;
}

async function fixture() {
  initTheme("dark", false);
  const cwd = await mkdtemp(join(tmpdir(), "pi-patch-changes-"));
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const pages: string[] = [];
  const notices: string[] = [];
  const menu = createMenuDriver();
  extension({
    getSettings: () => ({}), registerFlag() {}, getFlag: () => "aggregate",
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    on: (name: string, handler: Function) => handlers.set(name, handler),
    appendEntry() {},
    async exec(_command: string, args: string[]) { pages.push(args.at(-1)!); return { code: 0 }; },
  } as any);
  const ctx = {
    cwd, hasUI: true, mode: "tui", ui: { theme, notify: (message: string) => notices.push(message), custom: menu.custom },
    sessionManager: { buildContextEntries: () => [], getBranch: () => [] }, waitForIdle: async () => {},
  };
  const emit = async (name: string, event = {}) => handlers.get(name)!(event, ctx);
  await emit("session_start");
  await emit("agent_start");
  await emit("message_end", { message: { role: "user", content: "patch changes", timestamp: 1000 } });
  let id = 0;
  const patch = async (text: string, mutate: () => Promise<unknown>, parentToolCallId?: string, isError = false) => {
    const toolCallId = parentToolCallId ? `${parentToolCallId}/${++id}` : `patch-${++id}`;
    await emit("tool_execution_start", { toolCallId, toolName: "apply_patch", args: { patch: text }, parentToolCallId });
    await mutate();
    await emit("tool_execution_end", { toolCallId, toolName: "apply_patch", result: { content: [], details: undefined }, isError, parentToolCallId });
  };
  const finish = async () => {
    await emit("agent_settled");
    await commands.get("changes").handler("", ctx);
    const path = pages.at(-1);
    if (!path) return undefined;
    const html = await readFile(process.platform === "win32" ? new URL(path) : path, "utf8");
    const report = JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)![1]!) as ChangeReport;
    return { html, report };
  };
  const run = (name: string, args: unknown) => tools.get(name)!.execute("mixed", args, undefined, undefined, ctx);
  const setStyle = (style: string) => menu.change(() => commands.get("tools").handler("", ctx), "style", style);
  return { cwd, patch, finish, run, emit, notices, setStyle };
}

test("direct and nested patches share the first snapshot with Edit and Write", async () => {
  const { cwd, patch, finish, run, emit } = await fixture();
  try {
    await writeFile(join(cwd, "file.txt"), "original\n");
    await patch("*** Begin Patch\n*** Update File: file.txt\n@@\n-original\n+middle\n*** End Patch", () =>
      writeFile(join(cwd, "file.txt"), "middle\n"));
    await run("edit", { path: "file.txt", edits: [{ oldText: "middle", newText: "edited" }] });
    await patch("*** Begin Patch\n*** Update File: ./file.txt\n@@\n-edited\n+final\n*** End Patch", () =>
      writeFile(join(cwd, "file.txt"), "final\n"), "codemode-1");
    await run("write", { path: "new.txt", content: "new intermediate\n" });
    await patch("*** Begin Patch\n*** Update File: new.txt\n@@\n-new intermediate\n+new final\n*** End Patch", () =>
      writeFile(join(cwd, "new.txt"), "new final\n"), "codemode-1");
    const result = await finish();
    assert.ok(result, "patch changes should generate a report");
    assert.deepEqual(result.report.files.map(file => [file.path, file.status]), [["file.txt", "Modified"], ["new.txt", "Added"]]);
    const diff = JSON.stringify(result.report.files[0]!.diff);
    assert.match(diff, /original/);
    assert.match(diff, /final/);
    assert.doesNotMatch(diff, /middle|edited/);
    assert.equal(result.report.added, 2);
    assert.equal(result.report.deleted, 1);
  } finally {
    await emit("session_shutdown");
  }
});

test("a nested patch records additions, deletions and both ends of moves, including overwritten targets", async () => {
  const { cwd, patch, finish, emit } = await fixture();
  try {
    await writeFile(join(cwd, "deleted.txt"), "delete me\n");
    await writeFile(join(cwd, "source-new.txt"), "moved content\n");
    await writeFile(join(cwd, "source-existing.txt"), "replacement\n");
    await writeFile(join(cwd, "target-existing.txt"), "old target\n");
    await patch([
      "*** Begin Patch",
      `*** Add File: ${join(cwd, "added 文件.txt")}`, "+new content",
      "*** Delete File: deleted.txt",
      "*** Update File: source-new.txt", "*** Move to: target-new.txt", "@@", "-moved content", "+moved final",
      "*** Update File: source-existing.txt", "*** Move to: target-existing.txt", "@@", "-replacement", "+replacement final",
      "*** End Patch",
    ].join("\r\n"), async () => {
      await writeFile(join(cwd, "added 文件.txt"), "new content\n");
      await unlink(join(cwd, "deleted.txt"));
      await writeFile(join(cwd, "target-new.txt"), "moved final\n");
      await unlink(join(cwd, "source-new.txt"));
      await writeFile(join(cwd, "target-existing.txt"), "replacement final\n");
      await unlink(join(cwd, "source-existing.txt"));
    }, "codemode-only");
    const result = await finish();
    assert.ok(result, "nested-only changes should generate a report");
    assert.deepEqual(result.report.files.map(file => [file.path, file.status]), [
      ["added 文件.txt", "Added"], ["deleted.txt", "Deleted"],
      ["source-existing.txt", "Deleted"], ["source-new.txt", "Deleted"],
      ["target-existing.txt", "Modified"], ["target-new.txt", "Added"],
    ]);
    assert.match(JSON.stringify(result.report.files[4]!.diff), /old target/);
    assert.match(JSON.stringify(result.report.files[4]!.diff), /replacement final/);
    assert.equal(result.report.added, 3);
    assert.equal(result.report.deleted, 4);
  } finally {
    await emit("session_shutdown");
  }
});

test("patch snapshots retain Unavailable files and omit files restored by another tool", async () => {
  const { cwd, patch, finish, run, emit } = await fixture();
  try {
    await writeFile(join(cwd, "binary.bin"), Buffer.from([0, 1, 2]));
    await writeFile(join(cwd, "restored.txt"), "original\n");
    await patch([
      "*** Begin Patch",
      "*** Update File: binary.bin", "@@", "+text",
      "*** Update File: restored.txt", "@@", "-original", "+temporary",
      "*** End Patch",
    ].join("\n"), async () => {
      await writeFile(join(cwd, "binary.bin"), "text\n");
      await writeFile(join(cwd, "restored.txt"), "temporary\n");
    });
    await run("write", { path: "restored.txt", content: "original\n" });
    const result = await finish();
    assert.ok(result);
    assert.deepEqual(result.report.files.map(file => [file.path, file.status]), [["binary.bin", "Unavailable"]]);
    assert.equal(result.report.added, 0);
    assert.equal(result.report.deleted, 0);
    assert.match(result.report.files[0]!.notice!, /Binary file/);
  } finally {
    await emit("session_shutdown");
  }
});

test("failed patches retain committed writes and show one report-level incomplete notice", async () => {
  const { cwd, patch, finish, emit } = await fixture();
  try {
    await writeFile(join(cwd, "partial.txt"), "original\n");
    await patch([
      "*** Begin Patch", "*** Update File: partial.txt", "@@", "-original", "+committed",
      "*** Delete File: missing.txt", "*** End Patch",
    ].join("\n"), () => writeFile(join(cwd, "partial.txt"), "committed\n"), undefined, true);
    await patch("*** Begin Patch\n*** Delete File: missing-again.txt\n*** End Patch", async () => {}, "codemode-failed", true);
    const result = await finish();
    assert.ok(result);
    assert.deepEqual(result.report.files.map(file => [file.path, file.status]), [["partial.txt", "Modified"]]);
    assert.match(JSON.stringify(result.report.files[0]!.diff), /original/);
    assert.match(JSON.stringify(result.report.files[0]!.diff), /committed/);
    assert.equal(result.report.outcome, "completed", "a recovered tool failure is not an agent failure");
    assert.equal((result.html.match(/id="incomplete-notice"/g) ?? []).length, 1);
    assert.match(result.html, /Records may be incomplete/);
  } finally {
    await emit("session_shutdown");
  }
});

test("failures with no observed changes still generate a warning report, even without parseable paths", async () => {
  for (const text of ["not a patch", "*** Begin Patch\n*** Delete File: missing.txt\n*** End Patch"]) {
    const { patch, finish, emit } = await fixture();
    try {
      await patch(text, async () => {}, "codemode-failed", true);
      const result = await finish();
      assert.ok(result, "a failed patch must generate a report even if no files changed");
      assert.deepEqual(result.report.files, []);
      assert.equal(result.report.incomplete, true);
      assert.equal((result.html.match(/id="incomplete-notice"/g) ?? []).length, 1);
      assert.equal(await emptyDiffText(result.report), "No file changes could be confirmed.");
    } finally {
      await emit("session_shutdown");
    }
  }
});

test("successful patches restored to their starting state do not generate a report", async () => {
  const { cwd, patch, finish, emit, notices } = await fixture();
  try {
    await writeFile(join(cwd, "restored.txt"), "original\n");
    await patch("*** Begin Patch\n*** Update File: restored.txt\n@@\n-original\n+temporary\n*** End Patch", () =>
      writeFile(join(cwd, "restored.txt"), "temporary\n"));
    await patch("*** Begin Patch\n*** Update File: restored.txt\n@@\n-temporary\n+original\n*** End Patch", () =>
      writeFile(join(cwd, "restored.txt"), "original\n"));
    assert.equal(await finish(), undefined);
    assert.match(notices.at(-1)!, /No change report/);
  } finally {
    await emit("session_shutdown");
  }
});

test("header trailing whitespace follows helper semantics without treating diff context as a file operation", async () => {
  const { cwd, patch, finish, emit } = await fixture();
  try {
    await writeFile(join(cwd, "file.txt"), "*** Delete File: decoy.bin\nold\n");
    await writeFile(join(cwd, "decoy.bin"), Buffer.from([0]));
    await patch([
      "*** Begin Patch", "*** Update File: file.txt \t", "@@",
      " *** Delete File: decoy.bin", "-old", "+new", "*** End Patch",
    ].join("\n"), () => writeFile(join(cwd, "file.txt"), "*** Delete File: decoy.bin\nnew\n"));
    const result = (await finish())!;
    assert.deepEqual(result.report.files.map(file => [file.path, file.status]), [["file.txt", "Modified"]]);
    assert.equal(result.report.added, 1);
    assert.equal(result.report.deleted, 1);
  } finally {
    await emit("session_shutdown");
  }
});

test("patch failures do not leak into later tasks or replacement sessions", async () => {
  const { cwd, patch, finish, emit, run } = await fixture();
  try {
    await patch("bad patch", async () => {}, undefined, true);
    assert.equal((await finish())!.report.incomplete, true);
    await emit("agent_start");
    await run("write", { path: "next.txt", content: "clean task\n" });
    const next = (await finish())!;
    assert.equal(next.report.incomplete, undefined);
    assert.doesNotMatch(next.html, /id="incomplete-notice"/);
    assert.deepEqual(next.report.files.map(file => file.path), ["next.txt"]);
    await emit("agent_start");
    await patch("bad patch", async () => {}, "nested", true);
    await emit("session_start");
    await emit("agent_start");
    await run("write", { path: "replacement.txt", content: "clean session\n" });
    const replacement = (await finish())!;
    assert.equal(replacement.report.incomplete, undefined);
    assert.deepEqual(replacement.report.files.map(file => file.path), ["replacement.txt"]);
    assert.equal(await readFile(join(cwd, "next.txt"), "utf8"), "clean task\n");
  } finally {
    await emit("session_shutdown");
  }
});

test("off drops pending patch tracking and ignores patch events until re-enabled", async () => {
  const { cwd, patch, finish, emit, setStyle } = await fixture();
  try {
    await patch("*** Begin Patch\n*** Add File: discarded.txt\n+before off\n*** End Patch", () =>
      writeFile(join(cwd, "discarded.txt"), "before off\n"), undefined, true);
    await setStyle("off");
    await patch("*** Begin Patch\n*** Add File: disabled.txt\n+while off\n*** End Patch", () =>
      writeFile(join(cwd, "disabled.txt"), "while off\n"), "disabled-parent", true);
    assert.equal(await finish(), undefined);
    await setStyle("aggregate");
    await emit("agent_start");
    await patch("*** Begin Patch\n*** Update File: disabled.txt\n@@\n-while off\n+enabled\n*** End Patch", () =>
      writeFile(join(cwd, "disabled.txt"), "enabled\n"), "enabled-parent");
    const result = (await finish())!;
    assert.equal(result.report.incomplete, undefined);
    assert.deepEqual(result.report.files.map(file => [file.path, file.status]), [["disabled.txt", "Modified"]]);
    assert.match(JSON.stringify(result.report.files[0]!.diff), /while off/);
    assert.match(JSON.stringify(result.report.files[0]!.diff), /enabled/);
  } finally {
    await setStyle("aggregate");
    await emit("session_shutdown");
  }
});
