import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AssistantMessageComponent, SessionManager, initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import compactToolExtension from "../index.ts";

initTheme("dark", false);
const theme = {
  appearance: "dark", getColorMode: () => "truecolor",
  fg: (_: string, text: string) => text, bg: (_: string, text: string) => text,
  style: (text: string) => text, bold: (text: string) => text,
};

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "compact-changes-resume-"));
  let manager = SessionManager.create(cwd, join(cwd, "sessions"));
  const events = new Map<string, Function>();
  const commands = new Map<string, any>();
  const notices: string[] = [];
  const opened: string[][] = [];
  const tools = new Map<string, any>();
  const ctx = {
    cwd, mode: "tui", hasUI: true, sessionManager: manager,
    ui: { theme, notify(message: string) { notices.push(message); } },
    async waitForIdle() {},
  };
  const pi = {
    getSettings: () => ({}), getFlag: () => "aggregate",
    registerFlag() {},
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    on(name: string, handler: Function) { events.set(name, handler); },
    appendEntry(type: string, data: unknown) { manager.appendCustomEntry(type, data); },
    async exec(_command: string, args: string[]) {
      opened.push(args);
      return { code: 0, stdout: "", stderr: "" };
    },
  } as unknown as ExtensionAPI;
  const emit = async (type: string, data = {}) => {
    await events.get(type)?.({ type, ...data }, ctx);
  };
  const reload = async () => {
    await emit("session_shutdown");
    compactToolExtension(pi);
    await emit("session_start");
  };
  const resume = async () => {
    await emit("session_shutdown");
    manager = SessionManager.open(manager.getSessionFile()!);
    ctx.sessionManager = manager;
    compactToolExtension(pi);
    await emit("session_start");
  };
  const generate = async (timestamp: number) => {
    const user = { role: "user", content: "write a file", timestamp };
    manager.appendMessage(user as any);
    await emit("message_end", { message: user });
    await emit("agent_start");
    await tools.get("write").execute("write-test", { path: "file.txt", content: `${timestamp}\n` }, undefined, undefined, ctx);
    const final = {
      role: "assistant", content: [{ type: "text", text: "done" }], timestamp: timestamp + 1,
      stopReason: "stop", api: "openai-completions", provider: "openai", model: "test",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    manager.appendMessage(final as any);
    await emit("message_end", { message: final });
    await emit("agent_end", { messages: [user, final] });
    await emit("agent_settled");
    return final;
  };
  const open = () => commands.get("changes").handler("", ctx);
  compactToolExtension(pi);
  await emit("session_start");
  return { get manager() { return manager; }, emit, reload, resume, generate, open, notices, opened };
}

test("new reports and their historical links survive a fresh extension runtime", async () => {
  const f = await fixture();
  try {
    await f.open();
    assert.equal(f.notices.pop(), "No change report in this session yet.");
    const first = await f.generate(1000);
    await f.open();
    const firstPath = f.opened.at(-1)![0]!;
    assert.match(await readFile(firstPath, "utf8"), /report-data/);
    const second = await f.generate(2000);
    await f.open();
    const secondPath = f.opened.at(-1)![0]!;
    assert.notEqual(firstPath, secondPath);
    await f.reload();
    await f.open();
    assert.equal(f.opened.length, 3);
    assert.deepEqual(f.opened.at(-1), [secondPath]);
    for (const [message, path] of [[first, firstPath], [second, secondPath]] as const) {
      const rendered = new AssistantMessageComponent(message as any, true).render(180).join("\n");
      assert.ok(rendered.includes(pathToFileURL(path).href), rendered);
    }
    await f.resume();
    await f.open();
    assert.equal(f.opened.length, 4);
    assert.deepEqual(f.opened.at(-1), [secondPath]);
    assert.ok(new AssistantMessageComponent(first as any, true).render(180).join("\n").includes(pathToFileURL(firstPath).href));
  } finally { await f.emit("session_shutdown"); }
});

test("report selection follows the active branch, survives compaction and never guesses an old report", async () => {
  const f = await fixture();
  try {
    await f.generate(1000);
    await f.open();
    const firstPath = f.opened.at(-1)![0]!;
    const firstLeaf = f.manager.getLeafId()!;
    await f.generate(2000);
    const secondLeaf = f.manager.getLeafId()!;
    f.manager.branch(firstLeaf);
    await f.emit("session_tree");
    await f.open();
    assert.deepEqual(f.opened.at(-1), [firstPath]);
    // The newest compaction removes the report entry from model context.
    f.manager.appendMessage({ role: "user", content: "later", timestamp: 3000 } as any);
    f.manager.appendCompaction("summarized", f.manager.getLeafId()!, 0);
    await f.emit("session_compact");
    await f.reload();
    await f.open();
    assert.deepEqual(f.opened.at(-1), [firstPath]);
    f.manager.branch(secondLeaf);
    await f.emit("session_tree");
    await f.open();
    const secondPath = f.opened.at(-1)![0]!;
    assert.notEqual(secondPath, firstPath);
    const count = f.opened.length;
    await unlink(secondPath);
    await f.reload();
    await f.open();
    assert.equal(f.opened.length, count);
    assert.match(f.notices.at(-1)!, /missing or unreadable/);
    assert.ok(f.notices.at(-1)!.includes(secondPath));
    await mkdir(secondPath);
    await f.open();
    assert.equal(f.opened.length, count);
    assert.match(f.notices.at(-1)!, /missing or unreadable/);
    f.manager.resetLeaf();
    await f.emit("session_tree");
    await f.open();
    assert.equal(f.notices.at(-1), "No change report in this session yet.");
    assert.equal(f.opened.length, count);
  } finally { await f.emit("session_shutdown"); }
});
