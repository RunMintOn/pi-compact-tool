import { createMenuDriver } from "./helpers/menu.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ToolExecutionComponent, AssistantMessageComponent, initTheme, createBashToolDefinition, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { getDisplayPreferences, getToolColor } from "../src/state.ts";
import { decorateTool } from "../src/display.ts";
import { loadPreferences } from "../src/preferences.ts";

const { createCodemodeToolDefinition } = await import(new URL("./extensions/codemode/tool.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

test("legacy preferences retain display choices while missing or invalid colors fall back to blue and amber", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "pi-compact-legacy-colors-")), "preferences.json");
  writeFileSync(path, JSON.stringify({ codemodeView: "calls", showThinking: false }));
  assert.deepEqual(await loadPreferences(path), { codemodeView: "calls", showThinking: false, bashColor: "blue", codemodeColor: "amber" });
  writeFileSync(path, JSON.stringify({ codemodeView: "calls", showThinking: false, bashColor: "invalid", codemodeColor: "pink" }));
  assert.deepEqual(await loadPreferences(path), { codemodeView: "calls", showThinking: false, bashColor: "blue", codemodeColor: "pink" });
});

test("commands refresh existing rows and restore global preferences after reload and a different project", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-compact-preferences-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const notices: string[] = [];
  const menu = createMenuDriver();
  initTheme("dark", false);
  async function start() {
    const cwd = mkdtempSync(join(tmpdir(), "pi-compact-project-"));
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [new URL("../index.ts", import.meta.url).pathname] });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const { session } = await createAgentSession({ cwd, agentDir, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd) });
    await session.bindExtensions({ mode: "tui", uiContext: { custom: menu.custom, notify(message: string) { notices.push(message); } } as ExtensionUIContext });
    return { session, cwd };
  }
  let current: Awaited<ReturnType<typeof start>> | undefined;
  try {
    current = await start();
    assert.deepEqual(getDisplayPreferences(), { codemodeView: "compact", showThinking: true, bashColor: "blue", codemodeColor: "amber" });
    const row = new ToolExecutionComponent("codemode", "prefs", { code: "text('script');" }, {}, createCodemodeToolDefinition(), { requestRender() {} } as any, current.cwd);
    row.updateResult({ content: [{ type: "text", text: "output" }], details: { calls: [{ name: "read", args: "{}", status: "ok" }] }, isError: false });
    assert.equal(row.render(80).length, 1);
    assert.equal(getToolColor("codemode"), "amber");
    assert.match(row.render(80)[0]!, /\x1b\[38;2;214;178;115mcodemode/);
    const bash = new ToolExecutionComponent("bash", "color-bash", { command: "echo test" }, {}, decorateTool(createBashToolDefinition(current.cwd)), { requestRender() {} } as any, current.cwd);
    bash.updateResult({ content: [{ type: "text", text: "test" }], details: undefined, isError: false });
    bash.setExpanded(true);
    const originalBash = bash.render(80).join("\n");
    assert.equal(getToolColor("bash"), "blue");
    assert.match(originalBash, /\x1b\[38;2;142;175;210mbash/);
    await menu.change(() => current!.session.prompt("/tools"), "bashColor", "green");
    assert.equal(getToolColor("bash"), "green");
    assert.notEqual(bash.render(80).join("\n"), originalBash);
    await menu.change(() => current!.session.prompt("/tools"), "bashColor", "blue");
    assert.match(bash.render(80).join("\n"), /\x1b\[38;2;142;175;210mbash/);
    assert.match(bash.render(80).map(stripTerminalSequences).join("\n"), /test/);
    await menu.change(() => current!.session.prompt("/tools"), "bashColor", "cyan");
    assert.equal(getToolColor("bash"), "cyan");
    await menu.change(() => current!.session.prompt("/tools"), "codemodeColor", "pink");
    assert.equal(getToolColor("codemode"), "pink");
    assert.match(row.render(80)[0]!, /\x1b\[38;2;205;158;184mcodemode/);
    await menu.change(() => current!.session.prompt("/tools"), "bashColor", "blue");
    assert.equal(getToolColor("bash"), "blue");
    assert.equal(bash.render(80).join("\n"), originalBash);
    await menu.change(() => current!.session.prompt("/tools"), "codemodeView", "calls");
    assert.match(row.render(80).map(stripTerminalSequences).join("\n"), /✓ read/);
    row.setExpanded(true);
    await menu.change(() => current!.session.prompt("/tools"), "codemodeView", "compact");
    assert.match(row.render(80).map(stripTerminalSequences).join("\n"), /output/);
    await menu.change(() => current!.session.prompt("/tools"), "codemodeView", "calls");
    const assistant = new AssistantMessageComponent({ role: "assistant", content: [{ type: "thinking", thinking: "private thought" }], timestamp: 1, stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, api: "openai-completions", provider: "openai", model: "test" } as any, true);
    assert.match(assistant.render(80).map(stripTerminalSequences).join("\n"), /Thinking/);
    await menu.change(() => current!.session.prompt("/tools"), "showThinking", "隐藏");
    assert.deepEqual(assistant.render(80), []);
    assert.deepEqual(getDisplayPreferences(), { codemodeView: "calls", showThinking: false, bashColor: "blue", codemodeColor: "pink" });
    await menu.change(() => current!.session.prompt("/tools"), "showThinking", "显示");
    assert.match(assistant.render(80).map(stripTerminalSequences).join("\n"), /Thinking/);
    await menu.change(() => current!.session.prompt("/tools"), "showThinking", "隐藏");
    await menu.change(() => current!.session.prompt("/tools"), "bashColor", "purple");
    const before = getDisplayPreferences();
    assert.deepEqual(before, { codemodeView: "calls", showThinking: false, bashColor: "purple", codemodeColor: "pink" });
    assert.deepEqual(notices, []);
    assert.equal(current.session.messages.length, 0);
    const preferencesPath = join(agentDir, "extension-data/pi-compact-tool/preferences.json");
    const saved = readFileSync(preferencesPath, "utf8");
    assert.deepEqual(JSON.parse(saved), before);
    // Invalid on-disk data makes saving fail without relying on OS permission behavior.
    writeFileSync(preferencesPath, "{invalid");
    const failedSave = current.session.prompt("/tools");
    await menu.key("\x1b[B");
    await menu.key("\r");
    await menu.key("\x1b[B");
    await menu.key("\r");
    assert.deepEqual(getDisplayPreferences(), before);
    assert.match(menu.screen(), /Bash 颜色\s+purple/);
    assert.match(notices.at(-1)!, /无法保存展示偏好/);
    await menu.key("\x1b");
    await failedSave;
    writeFileSync(preferencesPath, saved);
    await current.session.reload();
    assert.equal(getToolColor("codemode"), "pink");
    assert.equal(getToolColor("bash"), "purple");
    assert.deepEqual(getDisplayPreferences(), before);
    await (current.session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    current.session.dispose();
    current = await start();
    assert.deepEqual(getDisplayPreferences(), before);
    await menu.change(() => current!.session.prompt("/tools"), "bashColor", "blue");
    await menu.change(() => current!.session.prompt("/tools"), "codemodeColor", "amber");
    await current.session.reload();
    assert.deepEqual(getDisplayPreferences(), { codemodeView: "calls", showThinking: false, bashColor: "blue", codemodeColor: "amber" });
    await menu.change(() => current!.session.prompt("/tools"), "style", "off");
    await current.session.reload();
    const viewingDisabled = current.session.prompt("/tools");
    await menu.ready();
    assert.match(menu.screen(), /Codemode 展示\s+calls（仅 aggregate 可用）/);
    assert.match(menu.screen(), /已结束的思考\s+隐藏（仅 aggregate 可用）/);
    await menu.key("\x1b");
    await viewingDisabled;
  } finally {
    if (current) {
      await (current.session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
      current.session.dispose();
    }
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
