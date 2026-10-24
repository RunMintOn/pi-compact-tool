import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager,
  AssistantMessageComponent, ToolExecutionComponent, initTheme, type ExtensionUIContext, type Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { getDisplayStyle } from "../src/state.ts";

test("actual Pi session loads the extension, retains active tools and switches existing rows without a model call", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-compact-session-"));
  const settingsManager = SettingsManager.inMemory({ shellCommandPrefix: "export COMPACT_SDK=ok;" });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir: cwd, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: [new URL("../index.ts", import.meta.url).pathname, new URL("./fixtures/custom-tool.ts", import.meta.url).pathname],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd) });
  try {
    assert.deepEqual(session.getActiveToolNames().sort(), ["bash", "edit", "read", "write"]);
    assert.ok(session.getToolDefinition("grep")?.renderCall);
    const custom = session.getToolDefinition("compact_test_search")!;
    assert.equal(custom.exposure, "deferred");
    assert.deepEqual(custom.annotations, { readOnlyHint: true });
    assert.equal(custom.namespace?.name, "test");
    assert.deepEqual(Object.keys((custom.parameters as any).properties), ["query"]);
    const customResult = await custom.execute("custom", { query: "needle" }, undefined, undefined, {} as any);
    assert.deepEqual(customResult.details, { count: 2 });
    const notices: string[] = [];
    initTheme("dark", false);
    const theme = { appearance: "dark", fg: (_: string, text: string) => text, style: (text: string) => text } as unknown as Theme;
    await session.bindExtensions({ mode: "tui", uiContext: { theme, notify(message: string) { notices.push(message); } } as ExtensionUIContext });
    const tool = session.getToolDefinition("read")!;
    const row = new ToolExecutionComponent("read", "sdk-row", { path: "sample.txt" }, {}, tool, { requestRender() {} } as any, cwd);
    row.updateResult({ content: [{ type: "text", text: "one\ntwo\nthree" }], details: undefined, isError: false });
    row.setExpanded(true);
    const fff = session.getToolDefinition("ffgrep")!;
    const originalExecute = fff.execute;
    const originalRenderer = fff.renderCall;
    const fffResult = await fff.execute("fff-sdk", { pattern: "needle", path: "src/" }, undefined, undefined, {} as any);
    const fffRow = new ToolExecutionComponent("ffgrep", "fff-sdk", { pattern: "needle", path: "src/" }, {}, fff, { requestRender() {} } as any, cwd);
    fffRow.updateResult({ ...fffResult, isError: false });
    assert.match(fffRow.render(100).join("\n"), /2 matches/);
    assert.doesNotMatch(fffRow.render(100).join("\n"), /original search fixture/);
    assert.equal(session.getToolDefinition("ffgrep")!.execute, originalExecute);
    assert.equal(session.getToolDefinition("ffgrep")!.renderCall, originalRenderer);
    assert.equal(session.getToolDefinition("ffgrep")!.exposure, "deferred");
    assert.deepEqual(session.getActiveToolNames().sort(), ["bash", "edit", "read", "write"]);
    const customRow = new ToolExecutionComponent("compact_test_search", "custom-sdk-row", { query: "needle" }, {}, custom, { requestRender() {} } as any, cwd);
    customRow.updateResult({ ...customResult, isError: false });
    assert.match(customRow.render(100).join("\n"), /2 matches/);
    await session.prompt("/tool-style tidy");
    assert.doesNotMatch(customRow.render(100).join("\n"), /compact_test_search\(/);
    assert.equal(getDisplayStyle(), "tidy");
    assert.match(row.render(100).join("\n"), /three/);
    await session.prompt("/tool-style");
    assert.equal(getDisplayStyle(), "claude");
    assert.match(customRow.render(100).join("\n"), /compact_test_search\(/);
    assert.match(row.render(100).join("\n"), /Read\(/);
    assert.match(row.render(100).join("\n"), /three/);
    assert.equal(session.messages.filter((message) => message.role === "assistant").length, 0);
    assert.equal(notices.length, 2);
    await session.prompt("/tool-style aggregate");
    const noticeCount = notices.length;
    const runner = (session as any)._extensionRunner;
    let now = 1000;
    const clock = t.mock.method(Date, "now", () => now);
    const usage = (output: number) => ({ input: 100, output, cacheRead: 0, cacheWrite: 0, totalTokens: 100 + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
    const toolMessage = { role: "assistant", content: [{ type: "toolCall", id: "tps-read", name: "read", arguments: { path: "sample.txt" } }], timestamp: 1100, stopReason: "toolUse", usage: usage(600), api: "openai-completions", provider: "openai", model: "test" };
    const final = { ...toolMessage, content: [{ type: "text", text: "TPS final answer" }], timestamp: 19000, stopReason: "stop", usage: usage(300) };
    try {
      const user = { role: "user", content: "TPS test", timestamp: 1000 };
      await runner.emit({ type: "message_end", message: user });
      await runner.emit({ type: "agent_start" });
      await runner.emit({ type: "message_end", message: toolMessage });
      now = 2000;
      await runner.emit({ type: "tool_execution_start", toolCallId: "tps-read", toolName: "read", args: { path: "sample.txt" } });
      now = 3000;
      await runner.emit({ type: "tool_execution_start", toolCallId: "tps-read/0", toolName: "bash", args: {}, parentToolCallId: "tps-read" });
      now = 11000;
      await runner.emit({ type: "tool_execution_end", toolCallId: "tps-read/0", toolName: "bash", result: {}, isError: false, parentToolCallId: "tps-read" });
      now = 12000;
      await runner.emit({ type: "tool_execution_end", toolCallId: "tps-read", toolName: "read", result: { content: [{ type: "text", text: "one" }] }, isError: false });
      now = 21000;
      await runner.emit({ type: "message_end", message: final });
      await runner.emit({ type: "agent_end", messages: [user, toolMessage, final] });
      await runner.emit({ type: "agent_settled" });
      const rendered = new AssistantMessageComponent(final as any, true).render(120).map(stripTerminalSequences).join("\n");
      assert.match(rendered, /total 20s \(tools 10s\) · 90\.0 tok\/s · \$0\.000/);
      assert.doesNotMatch(rendered, /Tools/);
      assert.equal(notices.length, noticeCount);
      const record = session.sessionManager.getBranch().find(entry => entry.type === "custom" && entry.customType === "compact-tool.activity.v1");
      assert.equal((record as any)?.data.tps, 90);
      assert.equal((record as any)?.data.tpsBasis, "excluding-tools");
    } finally { clock.mock.restore(); }
    await session.reload();
    assert.deepEqual(session.getActiveToolNames().sort(), ["bash", "edit", "read", "write"]);
    assert.equal(getDisplayStyle(), "aggregate");
    const replayFff = new ToolExecutionComponent("fffind", "fff-replay", { pattern: "index" }, {}, session.getToolDefinition("fffind")!, { requestRender() {} } as any, cwd);
    replayFff.updateResult({ content: [{ type: "text", text: "index.ts\nindex.js" }], details: { totalMatched: 2 }, isError: false });
    assert.match(replayFff.render(100).join("\n"), /2 files/);
    const aggregateRow = new ToolExecutionComponent("bash", "aggregate-sdk-row", { command: "check" }, {}, session.getToolDefinition("bash")!, { requestRender() {} } as any, cwd);
    aggregateRow.updateResult({ content: [{ type: "text", text: "first\nsecond" }], details: undefined, isError: true });
    assert.equal(aggregateRow.render(80).length, 1);
    assert.match(aggregateRow.render(80).join("\n"), /2 lines/);
    assert.doesNotMatch(aggregateRow.render(80).join("\n"), /failed:|second/);
  } finally {
    session.dispose();
  }
});

test("rendering after session disposal does not access stale extension context or API", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-compact-stale-"));
  const settingsManager = SettingsManager.inMemory({ outputPad: 0 });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir: cwd, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: [new URL("../index.ts", import.meta.url).pathname],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd) });
  initTheme("dark", false);
  const theme = {
    appearance: "dark", getColorMode: () => "truecolor", fg: (_: string, text: string) => text,
    style: (text: string) => text, bold: (text: string) => text,
  } as unknown as Theme;
  try {
    await session.bindExtensions({ mode: "tui", uiContext: { theme, notify() {} } as unknown as ExtensionUIContext });
    const message = {
      role: "assistant", timestamp: 1000, stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "inspect files" },
        { type: "toolCall", id: "stale-read", name: "read", arguments: { path: "sample.txt" } },
      ],
      api: "openai-completions", provider: "openai", model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
    const assistant = new AssistantMessageComponent(message as any, true, undefined, undefined, 0);
    const tool = new ToolExecutionComponent("read", "stale-read", { path: "sample.txt" }, {}, session.getToolDefinition("read")!, { requestRender() {} } as any, cwd);
    tool.updateResult({ content: [{ type: "text", text: "one" }], details: undefined, isError: false });
    const before = [assistant.render(80), tool.render(80)];
    assert.match(stripTerminalSequences(before[1]!.join("\n")), /^read/);
    session.dispose();
    assert.deepEqual([assistant.render(80), tool.render(80)], before);
    assistant.setOutputPad(1);
    assistant.render(80);
    assert.match(stripTerminalSequences(tool.render(80).join("\n")), /^ read/);
  } finally {
    // Release the prototype patches through the normal lifecycle, even though
    // dispose has already invalidated contexts without emitting shutdown.
    await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
  }
});
