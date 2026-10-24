import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssistantMessageComponent, ToolExecutionComponent, createReadToolDefinition, initTheme,
} from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";
import { getDisplayStyle } from "../src/state.ts";
import { decorateTool } from "../src/display.ts";

test("off startup and repeated live switching restore native rows and skip activity/report recording", async () => {
  initTheme("dark", false);
  const toolRender = ToolExecutionComponent.prototype.render;
  const assistantRender = AssistantMessageComponent.prototype.render;
  const commands = new Map<string, any>();
  const handlers = new Map<string, Function>();
  const tools = new Map<string, any>();
  const entries: unknown[] = [];
  const cwd = await mkdtemp(join(tmpdir(), "pi-compact-off-"));
  const ctx = {
    cwd, hasUI: true, mode: "tui",
    ui: { theme: {} as any, notify() {} },
    sessionManager: { buildContextEntries: () => [] },
  };
  extension({
    getSettings: () => ({}),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerFlag() {}, getFlag: () => "off",
    registerCommand: (name: string, command: any) => commands.set(name, command),
    on: (name: string, handler: Function) => handlers.set(name, handler),
    appendEntry: (...args: unknown[]) => entries.push(args),
  } as any);
  const emit = async (name: string, event = {}) => handlers.get(name)!(event, ctx);
  const makeRow = (definition: any) => {
    const row = new ToolExecutionComponent("read", "off-read", { path: "sample.txt" }, {}, definition, { requestRender() {} } as any, cwd);
    row.updateResult({ content: [{ type: "text", text: "one\ntwo\nthree" }], details: undefined, isError: false });
    return row;
  };
  const baseline = makeRow(createReadToolDefinition(cwd));
  const collapsedNative = baseline.render(100);
  baseline.setExpanded(true);
  const expandedNative = baseline.render(100);
  baseline.setExpanded(false);
  const row = makeRow(tools.get("read"));
  const message = {
    role: "assistant", timestamp: 1000, stopReason: "stop",
    content: [{ type: "thinking", thinking: "native thought" }, { type: "text", text: "native answer" }],
    api: "openai-completions", provider: "openai", model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
  };
  const answer = new AssistantMessageComponent(message as any, true);
  const baselineAnswer = answer.render(100);
  try {
    await emit("session_start");
    assert.equal(getDisplayStyle(), "off");
    assert.equal(ToolExecutionComponent.prototype.render, toolRender);
    assert.equal(AssistantMessageComponent.prototype.render, assistantRender);
    assert.deepEqual(row.render(100), baseline.render(100));
    const cooperativeOriginal = { ...createReadToolDefinition(cwd), name: "cooperative" };
    const cooperative = makeRow(decorateTool(cooperativeOriginal));
    const cooperativeNative = makeRow(cooperativeOriginal);
    const cooperativeBaseline = cooperativeNative.render(100);
    for (const style of ["aggregate", "tidy", "claude"]) {
      await commands.get("tool-style").handler(style, ctx);
      assert.notDeepEqual(row.render(100), collapsedNative);
      assert.notDeepEqual(cooperative.render(100), cooperativeBaseline);
      row.setExpanded(true);
      baseline.setExpanded(true);
      assert.match(row.render(100).join("\n"), /three/);
      await commands.get("tool-style").handler("off", ctx);
      assert.equal(ToolExecutionComponent.prototype.render, toolRender);
      assert.equal(AssistantMessageComponent.prototype.render, assistantRender);
      assert.deepEqual(row.render(100), expandedNative);
      assert.deepEqual(answer.render(100), baselineAnswer);
      assert.deepEqual(cooperative.render(100), cooperativeBaseline);
      const newRow = makeRow(tools.get("read"));
      const newBaseline = makeRow(createReadToolDefinition(cwd));
      assert.deepEqual(newRow.render(100), newBaseline.render(100));
      row.setExpanded(false);
      baseline.setExpanded(false);
    }
    await emit("message_end", { message: { role: "user", content: "off write", timestamp: 1 } });
    await emit("agent_start");
    await tools.get("write").execute("off-write", { path: "file.txt", content: "unchanged execution\n" }, undefined, undefined, ctx);
    await emit("message_end", { message });
    await emit("agent_end", { messages: [message] });
    await emit("agent_settled");
    assert.equal(await readFile(join(cwd, "file.txt"), "utf8"), "unchanged execution\n");
    assert.deepEqual(entries, []);
    assert.deepEqual(answer.render(100), baselineAnswer);
    await commands.get("tool-style").handler("", ctx);
    assert.equal(getDisplayStyle(), "aggregate");
    await emit("session_start");
    assert.equal(getDisplayStyle(), "aggregate");
    await commands.get("tool-style").handler("off", ctx);
    await emit("session_start");
    assert.equal(getDisplayStyle(), "off");
    assert.equal(ToolExecutionComponent.prototype.render, toolRender);
  } finally {
    await emit("session_shutdown");
  }
});
