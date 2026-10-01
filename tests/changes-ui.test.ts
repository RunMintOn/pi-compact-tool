import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssistantMessageComponent, createAgentSession, DefaultResourceLoader, initTheme,
  SessionManager, SettingsManager, type ExtensionUIContext, type Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ActivityProjection, renderActivitySummary } from "../src/activity.ts";
import extension from "../index.ts";

const theme = { appearance: "dark", fg: (_: string, text: string) => text, style: (text: string) => text } as unknown as Theme;
const usage = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const toolMessage = {
  role: "assistant", timestamp: 1100, stopReason: "toolUse", usage,
  content: [{ type: "toolCall", id: "change-write", name: "write", arguments: { path: "file.txt", content: "new\n" } }],
  api: "openai-completions", provider: "openai", model: "test",
};
const final = { ...toolMessage, timestamp: 2000, stopReason: "stop", content: [{ type: "text", text: "Finished" }] };

test("first summary line reserves the link, bounds narrow rows and leaves the date line unchanged", () => {
  const projection = new ActivityProjection();
  projection.ingest({ role: "user", timestamp: 1000 });
  projection.ingest(toolMessage);
  projection.ingest(final);
  const original = projection.summaryFor(final)!;
  projection.setChanges("assistant:2000", { label: "View changes", url: "file:///tmp/changes%20report.html" });
  const summary = projection.summaryFor(final)!;
  const wideRow = renderActivitySummary(summary, theme, 100, 0)[1]!;
  assert.match(stripTerminalSequences(wideRow), /write ×1  View changes$/);
  assert.match(wideRow, /\x1b\[4mView changes\x1b\[24m/);
  for (const width of [1, 2, 8, 14, 20, 40, 100]) {
    for (const pad of [0, 1]) {
      const rows = renderActivitySummary(summary, theme, width, pad);
      assert.equal(rows.length, 3);
      assert.ok(rows.every(row => visibleWidth(row) <= width));
      assert.equal(rows[2], renderActivitySummary(original, theme, width, pad)[2]);
      if (width - pad * 2 >= 13) {
        assert.match(stripTerminalSequences(rows[1]!), /View changes$/);
        assert.match(rows[1]!, /file:\/\/\/tmp\/changes%20report\.html/);
      }
      if (width === 20) assert.match(stripTerminalSequences(rows[1]!), /…/);
    }
  }
});

test("actual Pi session generates a linked report only at settlement without adding model-visible messages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-changes-session-"));
  const settingsManager = SettingsManager.inMemory({});
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir: cwd, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: [new URL("../index.ts", import.meta.url).pathname],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd) });
  initTheme("dark", false);
  const notices: string[] = [];
  try {
    await session.bindExtensions({ mode: "tui", uiContext: { theme, notify(message: string) { notices.push(message); } } as ExtensionUIContext });
    const runner = (session as any)._extensionRunner;
    await runner.emit({ type: "agent_start" });
    await runner.emit({ type: "message_end", message: { role: "user", content: "完整用户消息\n\n保留所有内容", timestamp: 1000 } });
    await runner.emit({ type: "message_end", message: toolMessage });
    await writeFile(join(cwd, "file.txt"), "old\n");
    const result = await session.getToolDefinition("write")!.execute("change-write", { path: "file.txt", content: "new\n" }, undefined, undefined, { cwd } as any);
    assert.match((result.content[0] as any).text, /Successfully/);
    await runner.emit({ type: "message_end", message: final });
    const answer = new AssistantMessageComponent(final as any, true);
    assert.doesNotMatch(answer.render(100).join("\n"), /View changes/);
    await runner.emit({ type: "agent_before_settle", outcome: "aborted" });
    await runner.emit({ type: "agent_settled" });
    const rendered = answer.render(100).join("\n");
    assert.match(stripTerminalSequences(rendered), /View changes/);
    const url = rendered.match(/\x1b\]8;;(file:[^\x1b]+)\x1b\\/)![1]!;
    const html = await readFile(new URL(url), "utf8");
    const report = JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)![1]!);
    assert.equal(report.outcome, "aborted");
    assert.deepEqual(report.prompts, ["完整用户消息\n\n保留所有内容"]);
    assert.equal(report.files[0].status, "Modified");
    assert.equal(report.added, 1);
    assert.equal(report.deleted, 1);
    assert.deepEqual(session.messages, []);
    assert.deepEqual(notices, []);
    // An active-branch rebuild in the same runtime retains the link.
    session.sessionManager.appendMessage(toolMessage as any);
    session.sessionManager.appendMessage(final as any);
    await runner.emit({ type: "session_tree" });
    assert.match(stripTerminalSequences(answer.render(100).join("\n")), /View changes/);
  } finally {
    await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
  }
});

test("/changes waits for settlement and opens the latest report with argv; launch failure exposes a file URL", async () => {
  const handlers = new Map<string, Function[]>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const launches: unknown[][] = [];
  const pi = {
    registerTool(tool: any) { tools.set(tool.name, tool); },
    getSettings: () => ({}), registerFlag() {}, getFlag: () => "aggregate",
    registerCommand(name: string, command: any) { commands.set(name, command); },
    on(name: string, handler: Function) { handlers.set(name, [...handlers.get(name) ?? [], handler]); },
    appendEntry() {},
    async exec(...args: unknown[]) { launches.push(args); return { code: 1, stderr: "no browser", stdout: "" }; },
  };
  extension(pi as any);
  const cwd = await mkdtemp(join(tmpdir(), "pi-changes-command-"));
  const notices: string[] = [];
  const ctx = {
    cwd, hasUI: true, mode: "tui", ui: { theme, notify(text: string) { notices.push(text); } },
    sessionManager: { buildContextEntries: () => [] }, waitForIdle: async () => {},
  };
  const emit = async (name: string, event = {}) => { for (const handler of handlers.get(name) ?? []) await handler(event, ctx); };
  await commands.get("changes").handler("", ctx);
  assert.match(notices.pop()!, /No change report/);
  await emit("session_start");
  await emit("agent_start");
  await emit("message_end", { message: { role: "user", content: "command test", timestamp: 1000 } });
  await emit("message_end", { message: toolMessage });
  await tools.get("write").execute("change-write", { path: "file.txt", content: "new\n" }, undefined, undefined, ctx);
  await emit("message_end", { message: final });
  let waited = false;
  ctx.waitForIdle = async () => { waited = true; await emit("agent_settled"); };
  await commands.get("changes").handler("", ctx);
  assert.equal(waited, true);
  assert.equal(launches.length, 1);
  assert.ok(Array.isArray(launches[0]![1]));
  assert.match(notices.pop()!, /^Open change report: file:\/\//);
  await emit("session_shutdown");
});
