import assert from "node:assert/strict";
import test from "node:test";
import { AssistantMessageComponent, ToolExecutionComponent, createReadToolDefinition, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { ActivityProjection, installActivityUI } from "../src/activity.ts";
import { decorateTool } from "../src/display.ts";
import { resetDisplayState, setDisplayStyle } from "../src/state.ts";

initTheme("dark", false);
const theme = { appearance: "dark", getColorMode: () => "truecolor", fg: (_: string, text: string) => text, style: (text: string) => text, bold: (text: string) => text } as unknown as Theme;
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const think = (text: string) => ({ type: "thinking", thinking: text });
const call = (id: string) => ({ type: "toolCall", id, name: "read", arguments: { path: id } });
const message = (content: any[], timestamp: number, stopReason = "toolUse") => ({ role: "assistant", content, timestamp, stopReason, usage, api: "openai-completions", provider: "openai", model: "test" });
const text = (rows: string[]) => rows.map(row => stripTerminalSequences(row).trimEnd());
const click = (y: number, height: number, width = 80) => ({ type: "click", button: "left", x: 3, y, width, height } as TuiMouseEvent);
function tool(id: string) {
  const row = new ToolExecutionComponent("read", id, { path: id }, {}, decorateTool(createReadToolDefinition(process.cwd())), { requestRender() {} } as any, process.cwd());
  row.updateResult({ content: [{ type: "text", text: "one" }], details: undefined, isError: false });
  return row;
}

test("thinking and tools share one panel without connection spacers, retaining native clicks and style switching", () => {
  resetDisplayState("aggregate");
  const p = new ActivityProjection();
  const first = message([think("first hidden thought"), call("a")], 1000);
  const second = message([think("second hidden thought"), call("b"), call("c")], 1100);
  p.ingest(first as any); p.ingest(second as any);
  const release = installActivityUI(p, () => theme);
  try {
    const a = new AssistantMessageComponent(first as any, true);
    const b = new AssistantMessageComponent(second as any, true);
    const rows = [...a.render(80), ...tool("a").render(80), ...b.render(80), ...tool("b").render(80), ...tool("c").render(80)];
    assert.deepEqual(text(rows), ["", "", " Thinking...", " read  a 1 line", "", " Thinking...", " parallel · 2 calls", " read  b 1 line", " read  c 1 line", ""]);
    assert.ok(rows.slice(1).every(row => /\x1b\[48;/.test(row)));
    assert.equal(a.handleMouse(click(1, 3)), undefined);
    assert.equal(a.handleMouse(click(2, 3))?.handled, true);
    assert.match(text(a.render(80)).join("\n"), /first hidden thought/);
    const expanded = a.render(80);
    assert.equal(a.handleMouse(click(2, expanded.length))?.handled, true);
    assert.doesNotMatch(text(a.render(80)).join("\n"), /first hidden thought/);
    assert.equal(b.handleMouse(click(0, 2)), undefined);
    assert.equal(b.handleMouse(click(1, 2))?.handled, true);
    assert.match(text(b.render(80)).join("\n"), /second hidden thought/);
    setDisplayStyle("tidy");
    assert.ok(b.render(80).every(row => !/\x1b\[48;/.test(row)));
    setDisplayStyle("aggregate");
    assert.match(text(b.render(80)).join("\n"), /second hidden thought/);
    for (const width of [1, 2, 8, 20]) assert.ok(a.render(width).every(row => visibleWidth(row) <= width));
  } finally { release(); }
});

test("mixed thinking and normal text only colors thinking and preserves each native toggle", () => {
  resetDisplayState("aggregate");
  const p = new ActivityProjection();
  const final = message([think("first secret"), { type: "text", text: "public explanation" }, think("second secret"), { type: "text", text: "final answer" }], 1000, "stop");
  p.ingest(message([call("earlier")], 900) as any);
  p.ingest(final as any);
  const release = installActivityUI(p, () => theme);
  try {
    const component = new AssistantMessageComponent(final as any, true);
    let rows = component.render(80);
    const thinking = rows.map((row, index) => stripTerminalSequences(row).includes("Thinking...") ? index : -1).filter(index => index >= 0);
    assert.equal(thinking.length, 2);
    assert.match(rows[thinking[0]!]!, /\x1b\[48;/);
    assert.doesNotMatch(rows[thinking[1]!]!, /\x1b\[48;/);
    for (const row of rows.filter(row => /public explanation|final answer/.test(stripTerminalSequences(row)))) assert.doesNotMatch(row, /\x1b\[48;/);
    assert.equal(component.handleMouse(click(thinking[1]!, rows.length))?.handled, true);
    rows = component.render(80);
    assert.match(text(rows).join("\n"), /second secret/);
    assert.doesNotMatch(text(rows).join("\n"), /first secret/);
    release();
    rows = component.render(80);
    assert.ok(rows.every(row => !/\x1b\[48;/.test(row)));
    assert.match(text(rows).join("\n"), /second secret/);
  } finally { release(); }
});

test("standalone thinking before an answer stays uncolored and retains native expansion", () => {
  resetDisplayState("aggregate");
  const p = new ActivityProjection();
  const final = message([think("standalone secret"), { type: "text", text: "answer without tools" }], 1200, "stop");
  p.ingest(final as any);
  const release = installActivityUI(p, () => theme);
  try {
    const component = new AssistantMessageComponent(final as any, true);
    const rows = component.render(80);
    assert.ok(rows.every(row => !/\x1b\[48;/.test(row)));
    const index = rows.findIndex(row => stripTerminalSequences(row).includes("Thinking..."));
    assert.equal(component.handleMouse(click(index, rows.length))?.handled, true);
    assert.match(text(component.render(80)).join("\n"), /standalone secret/);
    assert.equal(p.summaryFor(final as any), undefined);
  } finally { release(); }
});

test("streaming thinking stays native until tool calls are known, without changing the projection", () => {
  resetDisplayState("aggregate");
  const p = new ActivityProjection();
  const release = installActivityUI(p, () => theme);
  try {
    const component = new AssistantMessageComponent(undefined, true);
    component.updateContent(message([think("streamed thought")], 1000) as any, true);
    const rows = component.render(80);
    const index = rows.findIndex(row => stripTerminalSequences(row).includes("Thinking..."));
    assert.doesNotMatch(rows[index]!, /\x1b\[48;/);
    assert.equal(component.handleMouse(click(index, rows.length))?.handled, true);
    assert.match(text(component.render(80)).join("\n"), /streamed thought/);
    component.updateContent(message([think("streamed thought"), call("pending")], 1000) as any, true);
    const withTools = component.render(80);
    assert.match(withTools.find(row => stripTerminalSequences(row).includes("streamed thought"))!, /\x1b\[48;/);
    assert.equal(p.timingRecord().finalKey, undefined);
  } finally { release(); }
});
