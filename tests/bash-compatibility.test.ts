import { createMenuDriver } from "./helpers/menu.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAgentSession, createBashToolDefinition, DefaultResourceLoader,
  SessionManager, SettingsManager, ToolExecutionComponent, initTheme,
  type ExtensionUIContext, type Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

test("another extension owns bash execution while compact renders background handoffs", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "compact-bash-compat-"));
  const settingsManager = SettingsManager.inMemory({});
  const external = { ...createBashToolDefinition(cwd), description: "External bash execution" };
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir: cwd, settingsManager, noExtensions: true, noSkills: true,
    noThemes: true, noPromptTemplates: true, noContextFiles: true,
    additionalExtensionPaths: [new URL("../index.ts", import.meta.url).pathname],
    extensionFactories: [pi => pi.registerTool(external)],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSession({
    cwd, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd),
  });
  const menu = createMenuDriver();
  initTheme("dark", false);
  const theme = {
    appearance: "dark", getColorMode: () => "truecolor",
    fg: (_: string, text: string) => text, bg: (_: string, text: string) => text,
    style: (text: string) => text, bold: (text: string) => text,
  } as unknown as Theme;
  try {
    await session.bindExtensions({
      mode: "tui", uiContext: { theme, custom: menu.custom, notify() {} } as unknown as ExtensionUIContext,
    });
    const definition = session.getToolDefinition("bash")!;
    assert.equal(definition.description, "External bash execution");
    const short = await definition.execute("short", { command: "printf external" }, undefined, undefined,
      { cwd, sessionManager: session.sessionManager } as any);
    assert.equal(short.content[0]?.type, "text");
    assert.equal((short.content[0] as { text: string }).text, "external");
    const result = {
      content: [{ type: "text" as const, text: "Still running after 63 seconds.\nLog: /tmp/example.log" }],
      details: { task_id: "a3f8c921", status: "running", exit_code: null }, isError: false,
    };
    const row = new ToolExecutionComponent("bash", "external", { command: "long command" },
      {}, definition, { requestRender() {} } as any, cwd);
    row.updateResult(result);
    for (const style of ["aggregate", "tidy", "claude"]) {
      await menu.change(() => session.prompt("/tools"), "style", style);
      assert.match(stripTerminalSequences(row.render(100).join("\n")), /Backgrounded/);
      row.setExpanded(true);
      assert.match(stripTerminalSequences(row.render(100).join("\n")), /Still running/);
      row.setExpanded(false);
    }
    assert.equal(result.details.status, "running");
    assert.equal(result.details.exit_code, null);
  } finally {
    await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
  }
});
