import assert from "node:assert/strict";
import test from "node:test";
import { AssistantMessageComponent, ToolExecutionComponent, createReadToolDefinition, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { ActivityProjection, installActivityUI } from "../src/activity.ts";
import { decorateTool } from "../src/display.ts";
import { resetDisplayState, setDisplayStyle, setShowThinking } from "../src/state.ts";

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

test("hidden thinking leaves serial tools contiguous and preserves parallel section spacing and native expansion", () => {
  resetDisplayState("aggregate");
  const p = new ActivityProjection();
  const first = message([think("first secret"), call("a")], 1000);
  const second = message([think("second secret"), call("b")], 1100);
  const parallel = message([think("parallel secret"), call("c"), call("d")], 1200);
  const tail = message([think("tail secret"), call("e")], 1300);
  for (const m of [first, second, parallel, tail]) p.ingest(m as any);
  const release = installActivityUI(p, () => theme);
  try {
    const assistant = new AssistantMessageComponent(first as any, true);
    const before = assistant.render(80);
    assistant.handleMouse(click(2, before.length));
    assert.match(text(assistant.render(80)).join("\n"), /first secret/);
    const a = tool("a"); const b = tool("b"); const c = tool("c"); const d = tool("d"); const e = tool("e");
    setShowThinking(false);
    assert.deepEqual(assistant.render(80), []);
    for (const m of [second, parallel, tail]) assert.deepEqual(new AssistantMessageComponent(m as any, true).render(80), []);
    assert.deepEqual(text([...a.render(80), ...b.render(80), ...c.render(80), ...d.render(80), ...e.render(80)]), ["", "", " read  a 1 line", " read  b 1 line", "", " parallel · 2 calls", " read  c 1 line", " read  d 1 line", "", " read  e 1 line", ""]);
    p.ingest(message([think("new secret"), call("f")], 1400) as any);
    assert.deepEqual(text(e.render(80)), ["", " read  e 1 line"]);
    assert.deepEqual(text(tool("f").render(80)), [" read  f 1 line", ""]);
    setDisplayStyle("tidy");
    assert.match(text(assistant.render(80)).join("\n"), /first secret/);
    setDisplayStyle("aggregate");
    assert.deepEqual(assistant.render(80), []);
    setShowThinking(true);
    assert.match(text(assistant.render(80)).join("\n"), /first secret/);
    assert.equal(assistant.handleMouse(click(2, assistant.render(80).length))?.handled, true);
    assert.match(text(assistant.render(80)).join("\n"), /Thinking/);
  } finally { release(); resetDisplayState("aggregate"); }
});

test("hidden thinking keeps only the live stream and retains normal text, errors and final statistics", () => {
  resetDisplayState("aggregate");
  const p = new ActivityProjection();
  const release = installActivityUI(p, () => theme);
  try {
    setShowThinking(false);
    const streaming = new AssistantMessageComponent(undefined, true);
    streaming.updateContent(message([think("streamed secret")], 1000) as any, true);
    assert.match(text(streaming.render(80)).join("\n"), /Thinking/);
    const liveRows = streaming.render(80);
    const liveIndex = text(liveRows).findIndex(row => row.includes("Thinking"));
    assert.equal(streaming.handleMouse(click(liveIndex, liveRows.length))?.handled, true);
    assert.match(text(streaming.render(80)).join("\n"), /streamed secret/);
    streaming.updateContent(message([think("streamed secret"), call("running")], 1000) as any, true);
    assert.deepEqual(streaming.render(80), []);
    streaming.updateContent(message([think("streamed secret"), { type: "text", text: "public reply" }], 1000, "stop") as any, false);
    assert.deepEqual(text(streaming.render(80)), ["", " public reply"]);
    const mixed = new AssistantMessageComponent(message([{ type: "text", text: "before" }, think("secret"), { type: "text", text: "after" }], 2000, "stop") as any, false);
    assert.deepEqual(text(mixed.render(80)), ["", " before", " after"]);
    const error = new AssistantMessageComponent({ ...message([think("secret")], 2000, "error"), errorMessage: "provider failed" } as any, false);
    assert.match(text(error.render(80)).join("\n"), /provider failed/);
    assert.doesNotMatch(text(error.render(80)).join("\n"), /secret|Thinking/);
    p.ingest(message([call("a")], 1000) as any);
    const final = message([think("final secret"), { type: "text", text: "final reply" }], 2000, "stop");
    p.ingest(final as any);
    const renderedFinal = text(new AssistantMessageComponent(final as any, true).render(100));
    assert.equal(renderedFinal[0], "");
    const finalRows = renderedFinal.join("\n");
    assert.match(finalRows, /final reply/);
    assert.match(finalRows, /1 call/);
    assert.doesNotMatch(finalRows, /secret|Thinking/);
  } finally { release(); resetDisplayState("aggregate"); }
});

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
    assert.equal(p.summaryFor(final as any)?.calls, 0);
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
