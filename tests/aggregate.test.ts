import assert from "node:assert/strict";
import test from "node:test";
import { AssistantMessageComponent, SessionManager, ToolExecutionComponent, createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities, stripTerminalSequences, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { ACTIVITY_ENTRY, ActivityProjection, installActivityUI, renderActivitySummary } from "../src/activity.ts";
import { decorateTool } from "../src/display.ts";
import { resetDisplayState, setDisplayStyle } from "../src/state.ts";
import { testPng } from "./helpers/image.ts";

initTheme("dark", false);
const usage = { input: 100, output: 20, cacheRead: 30, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (content: any[], timestamp: number, stopReason = "toolUse") => ({ role: "assistant" as const, content, timestamp, stopReason, usage, api: "openai-completions", provider: "openai", model: "test" });
const call = (id: string, name = "read") => ({ type: "toolCall", id, name, arguments: { path: "sample.txt" } });
const output = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], details: undefined, isError });
const plain = (rows: string[]) => rows.map(stripTerminalSequences).join("\n");
const colorTheme = { fg: (color: string, text: string) => color === "error" ? `\x1b[31m${text}\x1b[39m` : color === "muted" ? `\x1b[90m${text}\x1b[39m` : text, bg: (_: string, text: string) => text, bold: (text: string) => text, style: (text: string) => text, appearance: "dark", getColorMode: () => "truecolor" } as unknown as Theme;

function fixture() {
  const p = new ActivityProjection();
  p.ingest({ role: "user", content: "test", timestamp: 1000 } as any);
  p.ingest(assistant([{ type: "thinking", thinking: "think before reading" }, call("r1"), call("r2")], 1100) as any);
  // Two separate single-call messages, with no thinking in between.
  p.ingest(assistant([call("e1", "edit")], 1200) as any);
  p.ingest(assistant([call("b1", "bash")], 1300) as any);
  return p;
}

test("parallel groups follow tool-call messages, not thinking boundaries; summary follows final answer", () => {
  const p = fixture();
  assert.equal(p.isParallel("r1"), true);
  assert.equal(p.isParallel("r2"), true);
  assert.equal(p.isParallel("e1"), false);
  assert.equal(p.isParallel("b1"), false);
  assert.equal(p.summaryFor(assistant([call("b1", "bash")], 1300) as any), undefined);
  const final = assistant([{ type: "text", text: "done" }], 2000, "stop");
  p.ingest(final as any);
  const summary = p.summaryFor(final as any)!;
  assert.equal(summary.calls, 4);
  assert.equal(summary.turns, 4);
  assert.deepEqual([...summary.counts], [["read", 2], ["edit", 1], ["bash", 1]]);
  assert.equal(summary.usage.input, 400);
  p.ingest({ role: "user", content: "next", timestamp: 3000 } as any);
  assert.equal(p.summaryFor(final as any)?.calls, 4);
  assert.equal(p.isParallel("r1"), true);
});

test("live execution events override inferred multi-call grouping for sequential execution", () => {
  const p = fixture();
  p.started("r1", 1400); p.ended("r1", 1450);
  p.started("r2", 1460); p.ended("r2", 1500);
  assert.equal(p.isParallel("r1"), false);
  assert.equal(p.isParallel("r2"), false);
  const q = fixture();
  q.started("r1", 1400); q.started("r2", 1410);
  q.ended("r2", 1420); q.ended("r1", 1500);
  assert.equal(q.isParallel("r1"), true);
  assert.equal(q.isParallel("r2"), true);
  const saved = q.timingRecord();
  const restored = fixture();
  restored.restoreTiming(saved);
  assert.equal(restored.isParallel("r1"), true);
});

test("history rebuild restores sequential dispatch and precise timing, and request summaries remain separate", () => {
  const p = fixture();
  p.started("r1", 1400); p.ended("r1", 1450);
  p.started("r2", 1460); p.ended("r2", 1500);
  const final = assistant([{ type: "text", text: "first final" }], 1900, "stop");
  p.ingest(final as any); p.completed(final as any, 2100);
  const q = new ActivityProjection();
  q.rebuild([
    { type: "message", message: { role: "user", content: "first", timestamp: 1000 } },
    { type: "message", message: assistant([call("r1"), call("r2")], 1100) },
    { type: "message", message: final },
    { type: "custom", customType: ACTIVITY_ENTRY, data: p.timingRecord() },
    { type: "message", message: { role: "user", content: "second", timestamp: 3000 } },
    { type: "message", message: assistant([call("next", "bash")], 3100) },
    { type: "message", message: assistant([{ type: "text", text: "second final" }], 4000, "stop") },
  ]);
  assert.equal(q.isParallel("r1"), false);
  assert.equal(q.isParallel("r2"), false);
  assert.equal(q.summaryFor(final as any)?.end, 2100);
  assert.equal(q.summaryFor(final as any)?.calls, 2);
  assert.equal(q.summaryFor(assistant([], 4000, "stop") as any)?.calls, 1);
});

test("aggregate summaries and tool rows fit narrow widths and reserve the date and Bash count", () => {
  const p = fixture();
  const final = assistant([{ type: "text", text: "done" }], new Date(2026, 7, 16, 19, 32, 25).getTime(), "stop");
  p.ingest(final as any);
  const summary = p.summaryFor(final as any)!;
  summary.start = final.timestamp - 64000;
  summary.usage = { input: 123456789, output: 123456789, cacheRead: 123456789, cacheWrite: 123456789 };
  resetDisplayState("aggregate");
  const tool = decorateTool(createBashToolDefinition(process.cwd()));
  const ctx: any = { args: { command: "printf 中文😀\\tlong\nsecond command" }, state: {}, toolCallId: "b", expanded: false, isPartial: false, isError: false, invalidate() {} };
  const header = tool.renderCall!(ctx.args, colorTheme, ctx);
  tool.renderResult!(output("one\ntwo"), { expanded: false, isPartial: false }, colorTheme, ctx);
  for (const width of [1, 2, 3, 5, 20, 60, 100]) {
    const rows = [...header.render(width), ...renderActivitySummary(summary, colorTheme, width)];
    assert.ok(rows.every(row => visibleWidth(row) <= width), JSON.stringify({ width, rows }));
  }
  assert.match(plain(header.render(60)), /2 lines/);
  assert.match(plain(renderActivitySummary(summary, colorTheme, 60)), /2026-08-16 \d{2}:\d{2}:\d{2}/);
});

test("aggregate Bash always has line count, including failure, empty output and truncation", () => {
  resetDisplayState("aggregate");
  const tool = decorateTool(createBashToolDefinition(process.cwd()));
  for (const [text, error, expected] of [["one\ntwo\n", false, "2 lines"], ["failure\nstack\n", true, "2 lines"], ["", false, "0 lines"]] as const) {
    const ctx: any = { args: { command: "a very long command ".repeat(20) }, state: {}, toolCallId: "bash", expanded: false, isPartial: false, isError: error, invalidate() {} };
    const header = tool.renderCall!(ctx.args, colorTheme, ctx);
    tool.renderResult!(output(text, error), { expanded: false, isPartial: false }, colorTheme, ctx);
    const rows = header.render(60);
    assert.equal(rows.length, 1);
    assert.ok(visibleWidth(rows[0]!) <= 60);
    assert.match(plain(rows), new RegExp(expected));
    assert.doesNotMatch(plain(rows), /failure|stack|failed:|applied/);
    if (error) assert.match(rows[0]!, /\x1b\[31m/);
    assert.match(rows[0]!, new RegExp(`\\x1b\\[90m${expected}`));
  }
  const ctx: any = { args: { command: "check" }, state: {}, toolCallId: "b", expanded: false, isPartial: false, isError: false, invalidate() {} };
  const header = tool.renderCall!(ctx.args, colorTheme, ctx);
  tool.renderResult!({ ...output("one\ntwo"), details: { truncation: { truncated: true } } } as any, { expanded: false, isPartial: false }, colorTheme, ctx);
  assert.match(plain(header.render(80)), /2 lines.*truncated/);
});

test("real Bash output counts exclude native empty-output and exit-status notices, including replay", async () => {
  resetDisplayState("aggregate");
  const p = new ActivityProjection();
  p.ingest({ role: "user", content: "bash", timestamp: 1000 });
  const commands = ["true", "printf 'one\\ntwo\\n'; exit 1", "exit 1"];
  const official = createBashToolDefinition(process.cwd());
  for (const [index, command] of commands.entries()) {
    const id = `real-bash-${index}`;
    p.ingest(assistant([{ type: "toolCall", id, name: "bash", arguments: { command } }], 1100 + index) as any);
    p.started(id, 1200 + index);
    const result = await official.execute(id, { command }, undefined, undefined, { cwd: process.cwd(), sessionManager: SessionManager.inMemory(process.cwd()) } as any);
    p.ended(id, 1300 + index, result);
    assert.equal(p.bashLines(id), index === 1 ? 2 : 0);
    const release = installActivityUI(p, () => colorTheme);
    try {
      const row = new ToolExecutionComponent("bash", id, { command }, {}, decorateTool(official), { requestRender() {} } as any, process.cwd());
      row.updateResult({ ...result, isError: index > 0 });
      const text = plain(row.render(80));
      assert.match(text, index === 1 ? /2 lines/ : /0 lines/);
      assert.doesNotMatch(text, /Command exited|no output/);
    } finally { release(); }
  }
  const q = new ActivityProjection();
  q.ingest(assistant(commands.map((command, index) => ({ type: "toolCall", id: `real-bash-${index}`, name: "bash", arguments: { command } })), 1100) as any);
  q.restoreTiming(p.timingRecord());
  assert.equal(q.bashLines("real-bash-1"), 2);
  assert.equal(q.bashLines("real-bash-2"), 0);
});

test("aggregate failed Edit hides error text and success stats, expanded view retains full error", () => {
  resetDisplayState("aggregate");
  const tool = decorateTool(createEditToolDefinition(process.cwd()));
  const ctx: any = { args: { path: "state.ts" }, state: {}, toolCallId: "e1", expanded: false, isPartial: false, isError: true, invalidate() {} };
  const header = tool.renderCall!(ctx.args, colorTheme, ctx);
  const result = output("exact text not found\nfull error");
  tool.renderResult!(result, { expanded: false, isPartial: false }, colorTheme, ctx);
  assert.equal(plain(header.render(80)).trim(), "edit  state.ts");
  assert.match(header.render(80)[0]!, /\x1b\[31m/);
  ctx.expanded = true;
  tool.renderCall!(ctx.args, colorTheme, ctx);
  tool.renderResult!(result, { expanded: true, isPartial: false }, colorTheme, ctx);
  assert.match(plain(header.render(80)), /full error/);
});

test("real Pi aggregate rows keep region spacing, preserve per-row click and thinking interaction, and restore patches", () => {
  resetDisplayState("aggregate");
  const p = fixture();
  const originalToolRender = ToolExecutionComponent.prototype.render;
  const originalAssistantRender = AssistantMessageComponent.prototype.render;
  const release = installActivityUI(p, () => colorTheme);
  try {
    const tool = decorateTool(createReadToolDefinition(process.cwd()));
    const row = new ToolExecutionComponent("read", "r1", { path: "sample.txt" }, {}, tool, { requestRender() {} } as any, process.cwd());
    row.updateResult(output("one\ntwo\nthree"));
    const rows = row.render(80);
    assert.equal(rows.length, 4);
    assert.equal(rows[0], "");
    assert.equal(stripTerminalSequences(rows[1]!), " ".repeat(80));
    assert.match(plain(rows.slice(2)), /^ parallel · 2 calls\s*\n read/);
    for (const y of [0, 1, 2]) assert.equal(row.handleMouse({ type: "click", button: "left", x: 5, y, width: 80, height: 4 } as TuiMouseEvent), undefined);
    assert.equal(row.handleMouse({ type: "click", button: "left", x: 5, y: 3, width: 80, height: 4 } as TuiMouseEvent)?.handled, true);
    assert.match(plain(row.render(80)), /three/);
    setDisplayStyle("tidy");
    assert.equal(row.render(80)[0], "");
    setDisplayStyle("aggregate");
    const final = assistant([{ type: "text", text: "final answer" }], 2000, "stop");
    p.ingest(final as any);
    const message = new AssistantMessageComponent(final as any, true);
    const rendered = plain(message.render(100));
    assert.ok(rendered.indexOf("final answer") < rendered.indexOf("Tools"));
    assert.match(rendered, /4 calls.*4 turns/);
    const thinking = new AssistantMessageComponent(assistant([{ type: "thinking", thinking: "hidden unique thinking" }, call("r1"), call("r2")], 1100) as any, true);
    assert.doesNotMatch(plain(thinking.render(100)), /hidden unique thinking/);
    assert.equal(thinking.handleMouse({ type: "click", button: "left", x: 3, y: 1, width: 100, height: 2 } as TuiMouseEvent)?.handled, true);
    assert.match(plain(thinking.render(100)), /hidden unique thinking/);
  } finally { release(); }
  assert.equal(ToolExecutionComponent.prototype.render, originalToolRender);
  assert.equal(AssistantMessageComponent.prototype.render, originalAssistantRender);
});

test("continuous panel separates parallel and serial sections without indenting calls", () => {
  resetDisplayState("aggregate");
  const p = new ActivityProjection();
  p.ingest({ role: "user", content: "tools", timestamp: 1000 });
  p.ingest(assistant([call("p1"), call("p2"), call("p3")], 1100) as any);
  p.ingest(assistant([call("s1"), call("s2")], 1200) as any);
  p.restoreTiming({ calls: [{ id: "p1", parallel: true }, { id: "p2", parallel: false }, { id: "p3", parallel: true }, { id: "s1", parallel: false }, { id: "s2", parallel: false }] });
  const release = installActivityUI(p, () => colorTheme);
  try {
    const tool = decorateTool(createReadToolDefinition(process.cwd()));
    const components = ["p1", "p2", "p3", "s1", "s2"].map(id => {
      const row = new ToolExecutionComponent("read", id, { path: id }, {}, tool, { requestRender() {} } as any, process.cwd());
      row.updateResult(output("one"));
      return row;
    });
    const rows = components.flatMap(row => row.render(80));
    assert.equal(rows.length, 10); // Outer separator, two padding rows, title, section separator, five calls.
    assert.equal(rows[0], "");
    for (const index of [1, 6, 9]) {
      assert.equal(stripTerminalSequences(rows[index]!), " ".repeat(80));
      assert.match(rows[index]!, /\x1b\[48;/);
    }
    assert.equal(stripTerminalSequences(rows[2]!).trimEnd(), " parallel · 3 calls");
    for (const index of [3, 4, 5, 7, 8]) assert.match(stripTerminalSequences(rows[index]!), /^ read /);
    assert.ok(rows.slice(1).every(row => /\x1b\[48;/.test(row)));
    const last = components[4]!;
    assert.equal(last.handleMouse({ type: "click", button: "left", x: 5, y: 1, width: 80, height: 2 } as TuiMouseEvent), undefined);
    assert.equal(last.handleMouse({ type: "click", button: "left", x: 5, y: 0, width: 80, height: 2 } as TuiMouseEvent)?.handled, true);
  } finally { release(); }
});

test("serial calls, adjacent parallel batches and trailing serial calls have unambiguous boundaries", () => {
  resetDisplayState("aggregate");
  const p = new ActivityProjection();
  p.ingest(assistant([call("a")], 1000) as any);
  p.ingest(assistant([call("b")], 1100) as any);
  p.ingest(assistant([call("c"), call("d"), call("e")], 1200) as any);
  p.ingest(assistant([call("f"), call("g")], 1300) as any);
  p.ingest(assistant([call("h")], 1400) as any);
  const release = installActivityUI(p, () => colorTheme);
  try {
    const tool = decorateTool(createReadToolDefinition(process.cwd()));
    const components = "abcdefgh".split("").map(id => {
      const row = new ToolExecutionComponent("read", id, { path: id }, {}, tool, { requestRender() {} } as any, process.cwd());
      row.updateResult(output("one\ntwo"));
      return row;
    });
    const textRows = components.flatMap(row => row.render(80)).map(row => stripTerminalSequences(row).trimEnd());
    assert.deepEqual(textRows, ["", "", " read  a 2 lines", " read  b 2 lines", "", " parallel · 3 calls", " read  c 2 lines", " read  d 2 lines", " read  e 2 lines", "", " parallel · 2 calls", " read  f 2 lines", " read  g 2 lines", "", " read  h 2 lines", ""]);
    for (const index of [2, 5]) {
      const row = components[index]!;
      for (const y of [0, 1]) assert.equal(row.handleMouse({ type: "click", button: "left", x: 5, y, width: 80, height: 3 } as TuiMouseEvent), undefined);
      assert.equal(row.handleMouse({ type: "click", button: "left", x: 5, y: 2, width: 80, height: 3 } as TuiMouseEvent)?.handled, true);
      assert.match(plain(row.render(80)), /two/);
    }
    for (const width of [1, 2, 8, 20]) assert.ok(components.flatMap(row => row.render(width)).every(row => visibleWidth(row) <= width));
    p.restoreTiming({ calls: ["c", "d", "e", "f", "g"].map(id => ({ id, parallel: false })) });
    const sequential = components.flatMap(row => row.render(80)).map(stripTerminalSequences);
    assert.equal(sequential.length, 15); // Eight calls, four expanded body rows and three outer spacing rows.
    assert.ok(sequential.every(row => !row.includes("parallel")));
  } finally { release(); }
});

test("request statistics preserve native padding without panel background or added blank lines", () => {
  const p = fixture();
  const final = assistant([{ type: "text", text: "done" }], 2000, "stop");
  p.ingest(final as any);
  const rows = renderActivitySummary(p.summaryFor(final as any)!, colorTheme, 80);
  assert.equal(rows.length, 2);
  assert.match(stripTerminalSequences(rows[0]!), /^ Tools /);
  assert.match(stripTerminalSequences(rows[1]!), /^ 1s · tokens/);
  assert.match(stripTerminalSequences(renderActivitySummary(p.summaryFor(final as any)!, colorTheme, 80, 0)[0]!), /^Tools /);
  assert.ok(rows.every(row => !/\x1b\[(?:48[;:]|4[0-7]m)/.test(row)));
});

test("zero native output padding aligns tools, parallel headings and assistant statistics", () => {
  resetDisplayState("aggregate");
  const p = fixture();
  const final = assistant([{ type: "text", text: "done" }], 2000, "stop");
  p.ingest(final as any);
  const release = installActivityUI(p, () => colorTheme, () => 0);
  try {
    const row = new ToolExecutionComponent("read", "r1", { path: "sample.txt" }, {}, decorateTool(createReadToolDefinition(process.cwd())), { requestRender() {} } as any, process.cwd());
    row.updateResult(output("one"));
    assert.match(stripTerminalSequences(row.render(80)[2]!), /^parallel /);
    assert.match(stripTerminalSequences(row.render(80)[3]!), /^read /);
    const message = new AssistantMessageComponent(final as any, true);
    message.setOutputPad(0);
    const stats = message.render(80).map(stripTerminalSequences).find(line => line.includes("Tools"));
    assert.match(stats!, /^Tools /);
  } finally { release(); }
});

test("native image interrupts a tool panel with colored padding above and below", () => {
  resetDisplayState("aggregate");
  const caps = getCapabilities();
  setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: false });
  const release = installActivityUI(fixture(), () => colorTheme);
  try {
    const tool = decorateTool(createReadToolDefinition(process.cwd()));
    const image = new ToolExecutionComponent("read", "r1", { path: "image.png" }, {}, tool, { requestRender() {} } as any, process.cwd());
    image.updateResult({ content: [{ type: "image", data: testPng().toString("base64"), mimeType: "image/png" }], details: undefined, isError: false });
    const next = new ToolExecutionComponent("read", "r2", { path: "sample.txt" }, {}, tool, { requestRender() {} } as any, process.cwd());
    next.updateResult(output("one"));
    const rows = image.render(80);
    const header = rows.findIndex(row => stripTerminalSequences(row).includes("image.png"));
    for (const index of [header + 1, rows.length - 1]) {
      assert.equal(stripTerminalSequences(rows[index]!), " ".repeat(80));
      assert.match(rows[index]!, /\x1b\[48;/);
    }
    assert.match(rows.join("\n"), /\x1b\]1337;File=/);
    assert.match(stripTerminalSequences(next.render(80)[0]!), /^ read/);
    assert.equal(image.handleMouse({ type: "click", button: "left", x: 5, y: header + 1, width: 80, height: rows.length } as TuiMouseEvent), undefined);
    assert.equal(image.handleMouse({ type: "click", button: "left", x: 5, y: header, width: 80, height: rows.length } as TuiMouseEvent)?.handled, true);
    assert.match(image.render(80).join("\n"), /\x1b\]1337;File=/);
    // The next section already provides top padding; don't add another panel row.
    const boundaryImage = new ToolExecutionComponent("read", "r2", { path: "image.png" }, {}, tool, { requestRender() {} } as any, process.cwd());
    boundaryImage.updateResult({ content: [{ type: "image", data: testPng().toString("base64"), mimeType: "image/png" }], details: undefined, isError: false });
    assert.doesNotMatch(boundaryImage.render(80).at(-1)!, /\x1b\[48;/);
    const lastImage = new ToolExecutionComponent("read", "b1", { path: "image.png" }, {}, tool, { requestRender() {} } as any, process.cwd());
    lastImage.updateResult({ content: [{ type: "image", data: testPng().toString("base64"), mimeType: "image/png" }], details: undefined, isError: false });
    assert.doesNotMatch(lastImage.render(80).at(-1)!, /\x1b\[48;/);
    image.setExpanded(false);
    image.setShowImages(false);
    const hidden = image.render(80);
    assert.match(stripTerminalSequences(hidden.at(-1)!), /image.png/);
    assert.doesNotMatch(hidden.join("\n"), /\x1b\]1337;File=/);
  } finally { release(); setCapabilities(caps); }
});

test("aggregate keeps native images rather than hiding them in grouping", () => {
  resetDisplayState("aggregate");
  const caps = getCapabilities();
  setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: false });
  const release = installActivityUI(fixture(), () => colorTheme);
  try {
    const row = new ToolExecutionComponent("read", "r1", { path: "image.png" }, {}, decorateTool(createReadToolDefinition(process.cwd())), { requestRender() {} } as any, process.cwd());
    row.updateResult({ content: [{ type: "image", data: testPng().toString("base64"), mimeType: "image/png" }], details: undefined, isError: false });
    assert.match(row.render(80).join("\n"), /\x1b\]1337;File=/);
    row.setExpanded(true);
    assert.match(row.render(80).join("\n"), /\x1b\]1337;File=/);
    row.setShowImages(false);
    assert.doesNotMatch(row.render(80).join("\n"), /\x1b\]1337;File=/);
  } finally { release(); setCapabilities(caps); }
});
