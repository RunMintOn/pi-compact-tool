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
  initTheme("dark", false);
  async function start() {
    const cwd = mkdtempSync(join(tmpdir(), "pi-compact-project-"));
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [new URL("../index.ts", import.meta.url).pathname] });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const { session } = await createAgentSession({ cwd, agentDir, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd) });
    await session.bindExtensions({ mode: "tui", uiContext: { notify(message: string) { notices.push(message); } } as ExtensionUIContext });
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
    await current.session.prompt("/tool-color bash green");
    assert.equal(getToolColor("bash"), "green");
    assert.notEqual(bash.render(80).join("\n"), originalBash);
    await current.session.prompt("/tool-color bash blue");
    assert.match(bash.render(80).join("\n"), /\x1b\[38;2;142;175;210mbash/);
    assert.match(bash.render(80).map(stripTerminalSequences).join("\n"), /test/);
    await current.session.prompt("/tool-color bash");
    assert.equal(getToolColor("bash"), "cyan");
    await current.session.prompt("/tool-color codemode pink");
    assert.equal(getToolColor("codemode"), "pink");
    assert.match(row.render(80)[0]!, /\x1b\[38;2;205;158;184mcodemode/);
    await current.session.prompt("/tool-color bash invalid");
    assert.equal(getToolColor("bash"), "cyan");
    assert.match(notices.at(-1)!, /green.*blue.*amber/);
    await current.session.prompt("/tool-color bash reset");
    assert.equal(getToolColor("bash"), "blue");
    assert.equal(bash.render(80).join("\n"), originalBash);
    await current.session.prompt("/tool-color");
    assert.match(notices.at(-1)!, /codemode=pink.*bash=blue/);
    await current.session.prompt("/codemode-view calls");
    assert.match(row.render(80).map(stripTerminalSequences).join("\n"), /✓ read/);
    row.setExpanded(true);
    await current.session.prompt("/codemode-view compact");
    assert.match(row.render(80).map(stripTerminalSequences).join("\n"), /output/);
    await current.session.prompt("/codemode-view");
    const assistant = new AssistantMessageComponent({ role: "assistant", content: [{ type: "thinking", thinking: "private thought" }], timestamp: 1, stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, api: "openai-completions", provider: "openai", model: "test" } as any, true);
    assert.match(assistant.render(80).map(stripTerminalSequences).join("\n"), /Thinking/);
    await current.session.prompt("/tool-thinking hide");
    assert.deepEqual(assistant.render(80), []);
    assert.deepEqual(getDisplayPreferences(), { codemodeView: "calls", showThinking: false, bashColor: "blue", codemodeColor: "pink" });
    await current.session.prompt("/tool-thinking");
    assert.match(assistant.render(80).map(stripTerminalSequences).join("\n"), /Thinking/);
    await current.session.prompt("/tool-thinking hide");
    await current.session.prompt("/tool-color bash purple");
    const before = getDisplayPreferences();
    assert.deepEqual(before, { codemodeView: "calls", showThinking: false, bashColor: "purple", codemodeColor: "pink" });
    await current.session.prompt("/codemode-view invalid");
    assert.deepEqual(getDisplayPreferences(), before);
    assert.match(notices.at(-1)!, /compact.*calls/);
    await current.session.prompt("/tool-thinking invalid");
    assert.deepEqual(getDisplayPreferences(), before);
    assert.match(notices.at(-1)!, /show.*hide/);
    assert.equal(current.session.messages.length, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(agentDir, "extension-data/pi-compact-tool/preferences.json"), "utf8")), before);
    await current.session.reload();
    assert.equal(getToolColor("codemode"), "pink");
    assert.equal(getToolColor("bash"), "purple");
    assert.deepEqual(getDisplayPreferences(), before);
    await (current.session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    current.session.dispose();
    current = await start();
    assert.deepEqual(getDisplayPreferences(), before);
    await current.session.prompt("/tool-color bash reset");
    await current.session.prompt("/tool-color codemode reset");
    await current.session.reload();
    assert.deepEqual(getDisplayPreferences(), { codemodeView: "calls", showThinking: false, bashColor: "blue", codemodeColor: "amber" });
  } finally {
    if (current) {
      await (current.session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
      current.session.dispose();
    }
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});
