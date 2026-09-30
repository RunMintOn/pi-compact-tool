import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager,
  ToolExecutionComponent, initTheme, type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { getDisplayStyle } from "../src/state.ts";

test("actual Pi session loads the extension, retains active tools and switches existing rows without a model call", async () => {
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
    await session.bindExtensions({ mode: "tui", uiContext: { notify(message: string) { notices.push(message); } } as ExtensionUIContext });
    const tool = session.getToolDefinition("read")!;
    const row = new ToolExecutionComponent("read", "sdk-row", { path: "sample.txt" }, {}, tool, { requestRender() {} } as any, cwd);
    row.updateResult({ content: [{ type: "text", text: "one\ntwo\nthree" }], details: undefined, isError: false });
    row.setExpanded(true);
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
    await session.reload();
    assert.deepEqual(session.getActiveToolNames().sort(), ["bash", "edit", "read", "write"]);
    assert.equal(getDisplayStyle(), "aggregate");
    const aggregateRow = new ToolExecutionComponent("bash", "aggregate-sdk-row", { command: "check" }, {}, session.getToolDefinition("bash")!, { requestRender() {} } as any, cwd);
    aggregateRow.updateResult({ content: [{ type: "text", text: "first\nsecond" }], details: undefined, isError: true });
    assert.equal(aggregateRow.render(80).length, 1);
    assert.match(aggregateRow.render(80).join("\n"), /2 lines/);
    assert.doesNotMatch(aggregateRow.render(80).join("\n"), /failed:|second/);
  } finally {
    session.dispose();
  }
});
