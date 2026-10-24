import assert from "node:assert/strict";
import test from "node:test";
import { ToolExecutionComponent, initTheme, type ToolDefinition, type Theme } from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { ActivityProjection, installActivityUI } from "../src/activity.ts";
import { resetDisplayState, setDisplayStyle, setCodemodeView } from "../src/state.ts";

initTheme("dark", false);
const theme = { appearance: "dark", getColorMode: () => "truecolor", fg: (_: string, text: string) => text, style: (text: string) => text, bold: (text: string) => text } as unknown as Theme;
const plain = (rows: string[]) => rows.map(stripTerminalSequences).join("\n");
const { createCodemodeToolDefinition } = await import(new URL("./extensions/codemode/tool.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);

function custom(name: string): ToolDefinition<any> {
  return {
    name, label: name, description: "fixture", parameters: Type.Object({ pattern: Type.String() }),
    exposure: "deferred", annotations: { readOnlyHint: true },
    async execute() { throw new Error("display must not execute the tool"); },
    renderCall: () => new Text("original custom title", 0, 0),
    renderResult: () => new Text("original custom result", 0, 0),
  };
}

test("apply_patch shows compact file targets and actual change counts, retaining native expanded details", () => {
  resetDisplayState("aggregate");
  const release = installActivityUI(new ActivityProjection(), () => theme);
  try {
    const definition = custom("apply_patch");
    const references = { ...definition };
    const patch = "*** Begin Patch\n*** Update File: src/旧.ts\n*** Move to: src/new.ts\n@@\n-old\n+new\n*** Add File: added.ts\n+hello\n*** Delete File: gone.ts\n*** End Patch";
    const row = new ToolExecutionComponent("apply_patch", "patch", { patch }, {}, definition, { requestRender() {} } as any, process.cwd());
    row.updateResult({ content: [{ type: "text", text: "Success. Updated the following files:\nM src/new.ts\nA added.ts\nD gone.ts\n" }], details: { changes: [
      { kind: "update", path: "src/旧.ts", moveTo: "src/new.ts", additions: 1, deletions: 1 },
      { kind: "add", path: "added.ts", additions: 1, deletions: 0 },
      { kind: "delete", path: "gone.ts", additions: 0, deletions: 8 },
    ] }, isError: false });
    assert.equal(row.render(120).length, 1);
    assert.match(plain(row.render(120)), /src\/旧.ts → src\/new.ts/);
    assert.match(plain(row.render(120)), /3 files \+2 -9/);
    assert.doesNotMatch(plain(row.render(120)), /Begin Patch|original custom|Success/);
    assert.deepEqual(definition, references);
    assert.equal(row.handleMouse({ type: "click", button: "left", x: 5, y: 0, width: 120, height: 1 } as TuiMouseEvent)?.handled, true);
    assert.match(plain(row.render(120)), /original custom result/);
    for (const style of ["tidy", "claude", "aggregate"] as const) {
      setDisplayStyle(style);
      assert.match(plain(row.render(120)), /original custom result/);
      for (const width of [1, 2, 15, 40]) assert.ok(row.render(width).every(line => visibleWidth(line) <= width));
    }
    release();
    assert.match(plain(row.render(120)), /original custom title/);
  } finally { release(); }
});

test("apply_patch legacy results, no-ops and failures never report requested line counts as applied", () => {
  resetDisplayState("aggregate");
  const release = installActivityUI(new ActivityProjection(), () => theme);
  try {
    const definition = { ...custom("apply_patch"), renderResult: undefined };
    const row = new ToolExecutionComponent("apply_patch", "legacy-patch", { patch: "*** Begin Patch\n*** Add File: a.ts\n+requested\n*** End Patch" }, {}, definition, { requestRender() {} } as any, process.cwd());
    row.updateResult({ content: [{ type: "text", text: "Success. Updated the following files:\nA a.ts\n" }], details: undefined, isError: false });
    assert.match(plain(row.render(80)), /a.ts.*1 file/);
    assert.doesNotMatch(plain(row.render(80)), /\+1/);
    row.setExpanded(true);
    assert.match(plain(row.render(80)), /Success/);
    row.setExpanded(false);
    row.updateResult({ content: [{ type: "text", text: "" }], details: undefined, isError: false }, true);
    assert.match(plain(row.render(80)), /running/);
    assert.equal(row.render(80).length, 1);
    row.updateResult({ content: [{ type: "text", text: "done" }], details: { changes: [{ additions: "unknown", deletions: 1 }] }, isError: false });
    assert.match(plain(row.render(80)), /1 file/);
    assert.doesNotMatch(plain(row.render(80)), /NaN|\+| -1/);
    row.updateResult({ content: [{ type: "text", text: "No changes needed" }], details: { changes: [] }, isError: false });
    assert.match(plain(row.render(80)), /no changes/);
    row.updateResult({ content: [{ type: "text", text: "Failed to find expected lines\nerror details" }], details: undefined, isError: true });
    assert.doesNotMatch(plain(row.render(80)), /1 file|\+1|applied/);
    row.setExpanded(true);
    assert.match(plain(row.render(80)), /error details/);
    row.updateArgs({ patch: "*** Begin Patch\n*** Update File: b.ts\n" });
    assert.match(plain(row.render(80)), /b.ts/);
  } finally { release(); }
});

test("apply_patch expanded failures show native error and recovery details only once in every style", () => {
  const recovery = "Changes already applied (in execution order):";
  const result = { content: [{ type: "text" as const, text: `FAILED_MATCH\n${recovery}\n- Updated: first.ts` }], details: undefined, isError: true };
  for (const style of ["tidy", "aggregate", "claude"] as const) {
    resetDisplayState(style);
    const release = installActivityUI(new ActivityProjection(), () => theme);
    try {
      const definition = { ...custom("apply_patch"),
        renderResult: () => new Text(result.content[0]!.text + "\nNATIVE_DIFF", 0, 0) };
      const row = new ToolExecutionComponent("apply_patch", "failed-patch", { patch: "*** Update File: first.ts" }, {}, definition, { requestRender() {} } as any, process.cwd());
      row.updateResult(result);
      for (let cycle = 0; cycle < 2; cycle++) {
        row.setExpanded(true);
        const expanded = plain(row.render(120));
        assert.equal(expanded.split("FAILED_MATCH").length - 1, 1, style);
        assert.equal(expanded.split(recovery).length - 1, 1, style);
        assert.equal(expanded.split("NATIVE_DIFF").length - 1, 1, style);
        row.setExpanded(false);
        assert.doesNotMatch(plain(row.render(120)), /Changes already applied|NATIVE_DIFF/);
      }
    } finally { release(); }
  }
});

test("large native apply_patch details stay complete and repeated frames reuse the panel layout", () => {
  resetDisplayState("aggregate");
  const release = installActivityUI(new ActivityProjection(), () => theme);
  try {
    const body = Array.from({ length: 4000 }, (_, i) => `+${i} native diff row 中文`).join("\n");
    const definition = { ...custom("apply_patch"),
      renderResult: (result: any) => new Text(body + "\n" + result.content[0].text, 0, 0) };
    const row = new ToolExecutionComponent("apply_patch", "large-patch", { patch: "*** Update File: large.ts" }, {}, definition, { requestRender() {} } as any, process.cwd());
    row.updateResult({ content: [{ type: "text", text: "INITIAL_RESULT" }], details: undefined, isError: false });
    row.setExpanded(true);
    const initial = row.render(120);
    assert.equal((plain(initial).match(/native diff row/g) ?? []).length, 4000);
    const started = performance.now();
    for (let i = 0; i < 5; i++) assert.deepEqual(row.render(120), initial);
    assert.ok(performance.now() - started < 100, "five warm frames should not repaint 4000 native rows");
    row.invalidate();
    assert.deepEqual(row.render(120), initial);
    for (const width of [40, 120]) {
      const rows = row.render(width);
      assert.ok(rows.every(line => visibleWidth(line) <= width));
      assert.match(plain(rows), /3999 native diff row 中文/);
    }
    row.updateResult({ content: [{ type: "text", text: "UPDATED_RESULT" }], details: undefined, isError: false });
    const updated = plain(row.render(120));
    assert.match(updated, /UPDATED_RESULT/);
    assert.doesNotMatch(updated, /INITIAL_RESULT/);
  } finally { release(); }
});

test("FFF tools adapt inside the UI without changing registered definitions or executing tools", () => {
  resetDisplayState("aggregate");
  const release = installActivityUI(new ActivityProjection(), () => theme);
  try {
    for (const [name, expected] of [["ffgrep", "7 matches"], ["fffind", "7 files"]]) {
      const definition = custom(name!);
      const references = { ...definition };
      const row = new ToolExecutionComponent(name!, "fff", { pattern: "needle", path: "src/" }, {}, definition, { requestRender() {} } as any, process.cwd());
      row.updateResult({ content: [{ type: "text", text: "full first match\nfull second match" }], details: { totalMatched: 7, totalFiles: 100 }, isError: false });
      const rendered = row.render(80);
      assert.equal(rendered.length, 1);
      assert.match(plain(rendered), /needle in src\//);
      assert.ok(plain(rendered).includes(expected!));
      assert.doesNotMatch(plain(rendered), /original custom|full first match/);
      assert.deepEqual(definition, references);
      assert.equal(row.handleMouse({ type: "click", button: "left", x: 5, y: 0, width: 80, height: 1 } as TuiMouseEvent)?.handled, true);
      assert.match(plain(row.render(80)), /full first match\s*\n.*full second match/);
      setDisplayStyle("claude");
      assert.ok(plain(row.render(80)).includes(`${name}(`));
      setDisplayStyle("aggregate");
      for (const width of [1, 2, 15, 40]) assert.ok(row.render(width).every(line => visibleWidth(line) <= width));
    }
  } finally { release(); }
});

test("automatic custom adaptation restores original renderers on release and leaves unknown tools alone", () => {
  resetDisplayState("aggregate");
  const release = installActivityUI(new ActivityProjection(), () => theme);
  const known = new ToolExecutionComponent("ffgrep", "known", { pattern: "test" }, {}, custom("ffgrep"), { requestRender() {} } as any, process.cwd());
  const unknown = new ToolExecutionComponent("other", "unknown", {}, {}, custom("other"), { requestRender() {} } as any, process.cwd());
  known.updateResult({ content: [{ type: "text", text: "match" }], details: undefined, isError: false });
  unknown.updateResult({ content: [{ type: "text", text: "match" }], details: undefined, isError: false });
  assert.match(plain(known.render(80)), /1 result line/);
  assert.match(plain(unknown.render(80)), /original custom title/);
  release();
  assert.match(plain(known.render(80)), /original custom title/);
  assert.match(plain(known.render(80)), /original custom result/);
});

test("calls mode extracts the entire native call region, streams updates and toggles the whole script", () => {
  resetDisplayState("aggregate");
  const release = installActivityUI(new ActivityProjection(), () => theme);
  try {
    const definition = createCodemodeToolDefinition();
    const code = "await tools.read({path: 'a'});\ntext('SCRIPT BODY');";
    const row = new ToolExecutionComponent("codemode", "calls", { code }, {}, definition, { requestRender() {} } as any, process.cwd());
    const calls = Array.from({ length: 12 }, (_, index) => ({ name: `read_${index}`, args: JSON.stringify({ path: "a".repeat(100) }), status: index === 0 ? "error" : "ok", durationMs: 5, ...(index === 0 ? { error: "nested error\nsecond error line" } : {}) }));
    const result = { content: [{ type: "text" as const, text: "SCRIPT OUTPUT" }], details: { calls }, isError: false };
    row.updateResult(result);
    assert.equal(row.render(100).length, 1);
    setCodemodeView("calls");
    const preview = plain(row.render(100));
    // Native expanded result with output removed is the independent reference for region fidelity.
    const native = definition.renderResult!({ ...result, content: [] }, { expanded: true, isPartial: false }, theme, { showImages: true, state: {} } as any);
    assert.deepEqual(row.render(100).slice(1).map(line => stripTerminalSequences(line).trimEnd()), native.render(98).slice(1).map((line: string) => " " + stripTerminalSequences(line).trimEnd()));
    assert.match(preview, /read_0/);
    assert.match(preview, /read_11/);
    assert.match(preview, /second error line/);
    assert.doesNotMatch(preview, /earlier calls|SCRIPT BODY|SCRIPT OUTPUT/);
    const callY = row.render(100).findIndex(line => stripTerminalSequences(line).includes("read_11"));
    assert.equal(row.handleMouse({ type: "click", button: "left", x: 3, y: callY, width: 100, height: row.render(100).length } as TuiMouseEvent)?.handled, true);
    assert.match(plain(row.render(100)), /SCRIPT BODY/);
    assert.match(plain(row.render(100)), /SCRIPT OUTPUT/);
    setCodemodeView("compact");
    assert.match(plain(row.render(100)), /SCRIPT BODY/);
    row.setExpanded(false);
    assert.equal(row.render(100).length, 1);
    setCodemodeView("calls");
    row.updateResult({ ...result, details: { calls: [{ name: "pending", args: "{}", status: "running" }] } }, true);
    assert.match(plain(row.render(100)), /… pending/);
    assert.doesNotMatch(plain(row.render(100)), /SCRIPT OUTPUT/);
    for (const width of [1, 2, 15, 40]) assert.ok(row.render(width).every(line => visibleWidth(line) <= width));
    row.updateResult({ ...result, details: { calls: [] } });
    assert.equal(row.render(100).length, 1);
    row.updateResult(result);
    setDisplayStyle("tidy");
    assert.doesNotMatch(plain(row.render(100)), /read_11/);
    setDisplayStyle("claude");
    assert.doesNotMatch(plain(row.render(100)), /read_11/);
  } finally { release(); resetDisplayState("aggregate"); }
});

test("actual codemode collapses to one row but expanded view retains native script and nested-call details", () => {
  resetDisplayState("aggregate");
  const release = installActivityUI(new ActivityProjection(), () => theme);
  try {
    const definition = createCodemodeToolDefinition();
    const row = new ToolExecutionComponent("codemode", "code", { code: "const result = await tools.read({path: 'a'});\ntext(result);" }, {}, definition, { requestRender() {} } as any, process.cwd());
    row.updateResult({ content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }, { type: "text", text: "script output" }], details: { calls: [{ name: "read", args: '{"path":"a"}', status: "ok", durationMs: 5 }] }, isError: false });
    const collapsed = row.render(100);
    assert.equal(collapsed.length, 1);
    assert.match(plain(collapsed), /codemode.*1 nested call/);
    row.setExpanded(true);
    const expanded = plain(row.render(100));
    assert.match(expanded, /text\(result\)/);
    assert.match(expanded, /read.*path.*5ms/);
    assert.match(expanded, /script output/);
    assert.equal(definition.name, "codemode");
    for (const width of [1, 8, 30]) assert.ok(row.render(width).every(line => visibleWidth(line) <= width));
    row.setExpanded(false);
    row.updateResult({ content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }, { type: "text", text: "script output" }], details: { calls: [] }, isError: false });
    assert.match(plain(row.render(100)), /1 line/);
    release();
    assert.match(plain(row.render(100)), /text\(result\)/);
    assert.doesNotMatch(plain(row.render(100)), /nested call/);
  } finally { release(); }
});
