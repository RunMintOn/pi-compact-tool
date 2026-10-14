import assert from "node:assert/strict";
import test from "node:test";
import { createBashToolDefinition, createWriteToolDefinition, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { decorateTool } from "../src/display.ts";
import { resetDisplayState } from "../src/state.ts";
import { ActivityProjection, installActivityUI } from "../src/activity.ts";

initTheme("dark", false);
const themeModule = await import(new URL("./modes/interactive/theme/theme.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

// Interpret SGR background changes, including foreground RGB sequences containing
// zeroes. This checks the actual host theme rather than a no-color theme stub.
function cellBackgrounds(row: string): Array<string | undefined> {
  let background: string | undefined;
  const cells: Array<string | undefined> = [];
  const tokens = row.match(/\x1b\[[0-9;:]*m|[^\x1b]/gu) ?? [];
  for (const token of tokens) {
    if (!token.startsWith("\x1b")) { cells.push(background); continue; }
    const codes = token.slice(2, -1).split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0 || code === 49) background = undefined;
      if (code === 38 || code === 48) {
        const size = codes[i + 1] === 2 ? 4 : 2;
        if (code === 48) background = codes.slice(i, i + size + 1).join(";");
        i += size;
      }
    }
  }
  return cells;
}

test("actual themed aggregate rows keep one continuous background across truncation and line-count suffix", () => {
  resetDisplayState("aggregate");
  const tool = decorateTool(createBashToolDefinition(process.cwd()));
  for (const command of ["check", "npm run check --workspace packages/compact-tool --reporter verbose ".repeat(8)]) {
    for (const isError of [false, true]) {
      const component = new ToolExecutionComponent("bash", "background", { command }, {}, tool, { requestRender() {} } as any, process.cwd());
      component.updateResult({ content: [{ type: "text", text: "one\ntwo\nthree" }], details: undefined, isError });
      for (const width of [40, 80, 120]) {
        const row = component.render(width).find(line => stripTerminalSequences(line).includes("3 lines"))!;
        assert.ok(row, "line count must be visible");
        const cells = cellBackgrounds(row);
        assert.equal(cells.length, width);
        assert.ok(cells[0], "background must be set");
        assert.ok(cells.every(background => background === cells[0]), JSON.stringify({ width, isError, text: stripTerminalSequences(row), backgrounds: cells }));
      }
    }
  }
});

test("only unfinished tool regions use native pending background through arguments and execution", () => {
  for (const name of ["dark", "light"]) {
    initTheme(name, false);
    resetDisplayState("aggregate");
    const theme = themeModule.theme;
    const p = new ActivityProjection();
    p.ingest({ role: "assistant", timestamp: 1000, content: [
      { type: "toolCall", id: "done", name: "bash" },
      { type: "toolCall", id: "pending", name: "write" },
    ] });
    const release = installActivityUI(p, () => theme);
    try {
      const done = new ToolExecutionComponent("bash", "done", { command: "echo done" }, {}, decorateTool(createBashToolDefinition(process.cwd())), { requestRender() {} } as any, process.cwd());
      done.updateResult({ content: [{ type: "text", text: "done" }], details: undefined, isError: false });
      const completedRows = done.render(60);
      const pending = new ToolExecutionComponent("write", "pending", {}, {}, decorateTool(createWriteToolDefinition(process.cwd())), { requestRender() {} } as any, process.cwd());
      const expected = cellBackgrounds(theme.bg("toolPendingBg", "x"))[0];
      const checkPending = () => {
        for (const width of [12, 60]) {
          for (const row of pending.render(width)) {
            if (!stripTerminalSequences(row)) continue;
            assert.ok(cellBackgrounds(row).every(background => background === expected), "entire unfinished region must use native pending background");
          }
        }
        assert.deepEqual(done.render(60), completedRows);
      };
      checkPending();
      pending.updateArgs({ path: "file.txt", content: "partial content" });
      checkPending();
      pending.setArgsComplete();
      pending.markExecutionStarted();
      pending.updateResult({ content: [{ type: "text", text: "writing" }], details: undefined, isError: false }, true);
      pending.setExpanded(true);
      checkPending();
      for (const isError of [false, true]) {
        pending.updateResult({ content: [{ type: "text", text: isError ? "write failed" : "done" }], details: undefined, isError });
        const row = pending.render(60).find(line => stripTerminalSequences(line).includes("write"))!;
        assert.notEqual(cellBackgrounds(row)[0], expected);
        assert.ok(cellBackgrounds(row).every(background => background === cellBackgrounds(row)[0]));
        assert.deepEqual(done.render(60), completedRows);
      }
    } finally { release(); }
  }
  initTheme("dark", false);
});
