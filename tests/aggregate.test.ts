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
const colorTheme = { fg: (color: string, text: string) => color === "error" ? `\x1b[31m${text}\x1b[39m` : color === "muted" ? `\x1b[90m${text}\x1b[39m` : text, bg: (_: string, text: string) => text, bold: (text: string) => `\x1b[1m${text}\x1b[22m`, style: (text: string) => text, appearance: "dark", getColorMode: () => "truecolor" } as unknown as Theme;

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

test("request cost sums assistant totals once, rounds to three decimals and rebuilds from history", () => {
  const p = new ActivityProjection();
  const first = { ...assistant([call("cost-read")], 1100), usage: { ...usage, cost: { ...usage.cost, input: 0.1, output: 0.1, cacheRead: 0.1001, total: 0.3001 } } };
  const final = { ...assistant([{ type: "text", text: "done" }], 2000, "stop"), usage: { ...usage, cost: { ...usage.cost, output: 0.3406, total: 0.3406 } } };
  const messages = [{ role: "user", timestamp: 1000 }, first, { role: "toolResult", usage: { cost: { total: 99 } } }, final];
  for (const message of messages) p.ingest(message);
  p.ingest(first); p.ingest(final);
  assert.equal(p.summaryFor(final)?.cost, 0.6407);
  assert.match(plain(renderActivitySummary(p.summaryFor(final)!, colorTheme, 120)), /total 1s · \$0\.641 · tokens/);
  const restored = new ActivityProjection();
  restored.rebuild(messages.map(message => ({ type: "message", message })));
  assert.equal(restored.summaryFor(final)?.cost, 0.6407);
  for (const width of [1, 2, 20, 60, 100]) {
    assert.ok(renderActivitySummary(restored.summaryFor(final)!, colorTheme, width).every(row => visibleWidth(row) <= width));
  }
  p.ingest({ role: "user", timestamp: 3000 });
  p.ingest(assistant([call("next-read")], 3100));
  const next = assistant([{ type: "text", text: "next" }], 4000, "stop");
  p.ingest(next);
  assert.equal(p.summaryFor(next)?.cost, 0);
  assert.match(plain(renderActivitySummary(p.summaryFor(next)!, colorTheme, 120)), /\$0\.000/);
  assert.equal(p.summaryFor(final)?.cost, 0.6407);
});

test("history without cost data omits the amount", () => {
  const p = new ActivityProjection();
  const { cost: _cost, ...uncostedUsage } = usage;
  const first = { ...assistant([call("old-read")], 1100), usage: uncostedUsage };
  const final = { ...assistant([{ type: "text", text: "old" }], 2000, "stop"), usage: uncostedUsage };
  p.rebuild([first, final].map(message => ({ type: "message", message })));
  assert.equal(p.summaryFor(final)?.cost, undefined);
  assert.doesNotMatch(plain(renderActivitySummary(p.summaryFor(final)!, colorTheme, 120)), /\$/);
});

test("old answer-only history without usage does not invent token or cost data", () => {
  const p = new ActivityProjection();
  const final = { role: "assistant", timestamp: 2000, stopReason: "stop", content: [{ type: "text", text: "old reply" }] };
  p.rebuild([
    { type: "message", message: { role: "user", timestamp: 1000 } },
    { type: "message", message: final },
  ]);
  const rendered = plain(renderActivitySummary(p.summaryFor(final)!, colorTheme, 120));
  assert.match(rendered, /total 1s/);
  assert.doesNotMatch(rendered, /tokens|cache|\$|tok\/s|calls|turns|tools /);
});

test("cache hit rate weights task inputs, includes writes only in the denominator and survives replay", () => {
  const p = new ActivityProjection();
  const user = { role: "user", timestamp: 1000 };
  const first = { ...assistant([call("cache-read")], 1100), usage: {
    ...usage, input: 100, output: 500000, cacheRead: 800, cacheWrite: 100,
  } };
  const final = { ...assistant([{ type: "text", text: "done" }], 2000, "stop"), usage: {
    ...usage, input: 100, output: 500000, cacheRead: 0, cacheWrite: 0,
  } };
  for (const message of [user, first, final]) p.ingest(message);
  p.settled(2000);
  const summary = p.summaryFor(final)!;
  const rendered = plain(renderActivitySummary(summary, colorTheme, 200));
  // 800 / (100 + 800 + 100 + 100), not the unweighted mean of 80% and 0%.
  assert.match(rendered, /cache 72\.7%/);
  assert.doesNotMatch(rendered, /cache read|cache write/);
  const restored = new ActivityProjection();
  restored.rebuild([
    ...[user, first, final].map(message => ({ type: "message", message })),
    { type: "custom", customType: ACTIVITY_ENTRY, data: p.timingRecord() },
  ]);
  assert.equal(plain(renderActivitySummary(restored.summaryFor(final)!, colorTheme, 200)), rendered);
});

test("cache rate distinguishes zero hits, all hits and unavailable input usage", () => {
  for (const [input, cacheRead, cacheWrite, expected] of [
    [100, 0, 0, "cache 0%"],
    [0, 100, 0, "cache 100%"],
    [0, 0, 100, "cache 0%"],
    [0, 0, 0, undefined],
  ] as const) {
    const p = new ActivityProjection();
    const final = { ...assistant([{ type: "text", text: "done" }], 2000, "stop"),
      usage: { ...usage, input, cacheRead, cacheWrite } };
    p.ingest(final);
    const rendered = plain(renderActivitySummary(p.summaryFor(final)!, colorTheme, 200));
    if (expected) assert.ok(rendered.includes(expected), rendered);
    else assert.doesNotMatch(rendered, /cache/);
  }
});

test("answer-only statistics use one content row with a compact date and unlabelled speed", () => {
  const p = new ActivityProjection();
  const start = new Date(2026, 9, 14, 19, 15, 18).getTime();
  const final = assistant([{ type: "text", text: "done" }], start + 32000, "stop");
  p.ingest({ role: "user", timestamp: start });
  p.ingest(final);
  const summary = p.summaryFor(final)!;
  summary.tps = 26;
  const rows = renderActivitySummary(summary, colorTheme, 200);
  assert.equal(rows.length, 2);
  assert.equal(rows[0], "");
  assert.match(stripTerminalSequences(rows[1]!), /total 32s · 26\.0 tok\/s/);
  assert.match(stripTerminalSequences(rows[1]!), /10-14 19:15:50$/);
  assert.doesNotMatch(plain(rows), /turns|calls|TPS|2026-/);
  summary.changes = { label: "View changes", url: "file:///tmp/changes.html" };
  assert.match(plain(renderActivitySummary(summary, colorTheme, 200)), /View changes/);
  summary.changes = { label: "No net changes" };
  assert.match(plain(renderActivitySummary(summary, colorTheme, 200)), /19:15:50 No net changes/);
  for (const width of [1, 2, 20, 60, 100]) {
    assert.ok(renderActivitySummary(summary, colorTheme, width).every(row => visibleWidth(row) <= width));
  }
});

test("TPS excludes tool wall time and restores the new formula on replay", () => {
  const p = new ActivityProjection();
  p.ingest({ role: "user", timestamp: 1000 });
  p.ingest(assistant([call("r1")], 1100));
  p.agentStarted(1000);
  p.started("r1", 2000); p.ended("r1", 12000);
  const final = assistant([{ type: "text", text: "done" }], 19000, "stop");
  p.ingest(final as any);
  const messages = [
    { role: "user" },
    { ...assistant([call("r1")], 1100), usage: { ...usage, output: 600 } },
    { role: "toolResult" },
    { ...final, usage: { ...usage, output: 300 } },
  ];
  p.agentEnded(messages, 21000);
  p.settled(21000);
  assert.equal(p.summaryFor(final as any)?.tps, 90);
  assert.equal(p.summaryFor(final as any)?.toolMs, 10000);
  assert.match(plain(renderActivitySummary(p.summaryFor(final as any)!, colorTheme, 120)), /total 20s \(tools 10s\) · 90\.0 tok\/s · \$0\.000 · tokens/);
  for (const width of [1, 2, 20, 60, 100]) {
    assert.ok(renderActivitySummary(p.summaryFor(final as any)!, colorTheme, width).every(row => visibleWidth(row) <= width));
  }
  const restored = new ActivityProjection();
  restored.rebuild([
    { type: "message", message: { role: "user", timestamp: 1000 } },
    { type: "message", message: assistant([call("r1")], 1100) },
    { type: "message", message: final },
    { type: "custom", customType: ACTIVITY_ENTRY, data: p.timingRecord() },
  ]);
  assert.equal(restored.summaryFor(final as any)?.tps, 90);
  assert.equal(restored.summaryFor(final as any)?.toolMs, 10000);
  restored.rebuild([
    { type: "message", message: assistant([call("r1")], 1100) },
    { type: "message", message: final },
  ]);
  assert.doesNotMatch(plain(renderActivitySummary(restored.summaryFor(final as any)!, colorTheme, 120)), /tok\/s/);
});

test("TPS skips missing starts, zero elapsed time and zero output, and resets between runs", () => {
  const p = fixture();
  const final = assistant([{ type: "text", text: "done" }], 2000, "stop");
  p.ingest(final as any);
  p.agentEnded([final], 3000);
  assert.equal(p.summaryFor(final as any)?.tps, undefined);
  p.agentStarted(3000); p.agentEnded([final], 3000);
  assert.equal(p.summaryFor(final as any)?.tps, undefined);
  p.agentStarted(3000); p.agentEnded([{ ...final, usage: { ...usage, output: 0 } }], 4000);
  assert.equal(p.summaryFor(final as any)?.tps, undefined);
  p.agentEnded([final], 5000);
  assert.equal(p.summaryFor(final as any)?.tps, undefined);
  p.agentStarted(5000); p.agentEnded([final], 6000);
  p.settled(6000);
  assert.equal(p.summaryFor(final as any)?.tps, 20);
  p.ingest({ role: "user", timestamp: 7000 });
  const next = assistant([{ type: "text", text: "no tools" }], 8000, "stop");
  p.ingest(next as any);
  p.agentStarted(7000); p.agentEnded([next], 9000);
  p.settled(9000);
  assert.equal(p.summaryFor(next as any)?.calls, 0);
  assert.equal(p.summaryFor(next as any)?.tps, 10);
  assert.equal(p.summaryFor(final as any)?.tps, 20);
});

test("a continuation without output does not reuse the previous run's TPS", () => {
  const p = fixture();
  const first = assistant([{ type: "text", text: "first" }], 2000, "stop");
  p.ingest(first as any);
  p.agentStarted(1000); p.agentEnded([first], 3000);
  p.settled(3000);
  assert.equal(p.summaryFor(first as any)?.tps, 10);
  p.agentStarted(4000);
  const next = { ...assistant([{ type: "text", text: "next" }], 5000, "stop"), usage: { ...usage, output: 0 } };
  p.ingest(next as any); p.agentEnded([next], 6000);
  p.settled(6000);
  assert.equal(p.summaryFor(next as any)?.tps, undefined);
});

test("parallel tool intervals are merged; serial intervals and failed/aborted results still count", () => {
  const p = new ActivityProjection();
  p.ingest({ role: "user", timestamp: 1000 });
  const tools = assistant([call("a", "bash"), call("b"), call("c"), call("d")], 1100);
  p.ingest(tools);
  p.agentStarted(1000);
  p.started("a", 2000); p.started("b", 3000); p.started("c", 4000);
  p.ended("b", 5000); p.ended("c", 7000); p.ended("a", 6000);
  p.started("d", 8000); p.ended("d", 10000, output("Operation aborted", true));
  const final = assistant([{ type: "text", text: "done" }], 11000, "aborted");
  p.ingest(final);
  p.agentEnded([tools, final], 11000);
  p.settled(11000);
  assert.equal(p.summaryFor(final)?.toolMs, 7000);
  assert.equal(p.summaryFor(final)?.tps, 40 / 3);
  p.ingest({ role: "user", timestamp: 12000 });
  assert.equal(p.summaryFor(final)?.toolMs, 7000);
});

test("TPS clips tools to the agent run while displayed tools cover the user request", () => {
  const p = new ActivityProjection();
  p.ingest({ role: "user", timestamp: 1000 });
  const firstTools = assistant([call("first")], 1100);
  p.ingest(firstTools); p.started("first", 2000); p.ended("first", 4000);
  const first = assistant([{ type: "text", text: "first" }], 5000, "stop");
  p.ingest(first); p.agentStarted(1000); p.agentEnded([firstTools, first], 5000);
  const nextTools = assistant([call("next")], 6000);
  p.ingest(nextTools); p.started("next", 6000); p.ended("next", 10000);
  const final = assistant([{ type: "text", text: "final" }], 12000, "stop");
  p.ingest(final); p.agentStarted(7000); p.agentEnded([nextTools, final], 11000);
  p.settled(11000);
  assert.equal(p.summaryFor(final)?.toolMs, 6000);
  assert.equal(p.summaryFor(final)?.tps, 40);
});

test("missing tool timing and zero remaining model time omit TPS", () => {
  for (const end of [undefined, 9000, 2000]) {
    const p = new ActivityProjection();
    p.ingest({ role: "user", timestamp: 1000 });
    const tools = assistant([call("a")], 1100);
    p.ingest(tools); p.started("a", 1000);
    if (end !== undefined) p.ended("a", end);
    const final = assistant([{ type: "text", text: "done" }], 2000, "stop");
    p.ingest(final); p.agentStarted(1000); p.agentEnded([tools, final], 2000);
    p.settled(2000);
    assert.equal(p.summaryFor(final)?.tps, undefined);
    if (end === undefined) assert.equal(p.summaryFor(final)?.toolMs, undefined);
  }
});

test("old persisted TPS is not displayed under the new formula; tool intervals remain usable", () => {
  const p = new ActivityProjection();
  const tools = assistant([call("a")], 1100);
  const final = assistant([{ type: "text", text: "done" }], 5000, "stop");
  p.rebuild([
    { type: "message", message: { role: "user", timestamp: 1000 } },
    { type: "message", message: tools }, { type: "message", message: final },
    { type: "custom", customType: ACTIVITY_ENTRY, data: { calls: [{ id: "a", start: 2000, end: 4000, parallel: false }], finalKey: `assistant:${final.timestamp}`, start: 1000, end: 5000, tps: 10 } },
  ]);
  assert.equal(p.summaryFor(final)?.toolMs, 2000);
  assert.equal(p.summaryFor(final)?.tps, undefined);
  assert.match(plain(renderActivitySummary(p.summaryFor(final)!, colorTheme, 120)), /total 4s \(tools 2s\)/);
  assert.doesNotMatch(plain(renderActivitySummary(p.summaryFor(final)!, colorTheme, 120)), /tok\/s/);
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
  const p = new ActivityProjection();
  p.ingest({ role: "user", timestamp: 1000 });
  p.ingest(assistant([call("r1"), call("r2")], 1100));
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
  assert.match(plain(renderActivitySummary(summary, colorTheme, 60)), /08-16 \d{2}:\d{2}:\d{2}/);
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
    assert.equal(rows.length, 2); // Thinking owns this region's leading padding.
    assert.match(plain(rows), /^ parallel · 2 calls\s*\n read/);
    assert.equal(row.handleMouse({ type: "click", button: "left", x: 5, y: 0, width: 80, height: 2 } as TuiMouseEvent), undefined);
    assert.equal(row.handleMouse({ type: "click", button: "left", x: 5, y: 1, width: 80, height: 2 } as TuiMouseEvent)?.handled, true);
    assert.match(plain(row.render(80)), /three/);
    setDisplayStyle("tidy");
    assert.equal(row.render(80)[0], "");
    setDisplayStyle("aggregate");
    const final = assistant([{ type: "text", text: "final answer" }], 2000, "stop");
    p.ingest(final as any);
    const message = new AssistantMessageComponent(final as any, true);
    const rendered = plain(message.render(100));
    assert.ok(rendered.indexOf("final answer") < rendered.indexOf("4 calls"));
    assert.match(rendered, /4 calls.*4 turns/);
    const thinking = new AssistantMessageComponent(assistant([{ type: "thinking", thinking: "hidden unique thinking" }, call("r1"), call("r2")], 1100) as any, true);
    assert.doesNotMatch(plain(thinking.render(100)), /hidden unique thinking/);
    assert.equal(thinking.handleMouse({ type: "click", button: "left", x: 3, y: 2, width: 100, height: 3 } as TuiMouseEvent)?.handled, true);
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

test("request statistics have one separator, no bold or background, and preserve native padding", () => {
  const p = fixture();
  const final = assistant([{ type: "text", text: "done" }], 2000, "stop");
  p.ingest(final as any);
  const rows = renderActivitySummary(p.summaryFor(final as any)!, colorTheme, 80);
  assert.equal(rows.length, 3);
  assert.equal(rows[0], "");
  assert.match(stripTerminalSequences(rows[1]!), /^ 4 calls · 4 turns/);
  assert.doesNotMatch(plain(rows), /Tools/);
  assert.match(stripTerminalSequences(rows[2]!), /^ total 1s · \$0\.000 · tokens/);
  assert.doesNotMatch(rows[1]!, /\x1b\[1m/);
  assert.match(stripTerminalSequences(renderActivitySummary(p.summaryFor(final as any)!, colorTheme, 80, 0)[1]!), /^4 calls /);
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
    assert.match(stripTerminalSequences(row.render(80)[0]!), /^parallel /);
    assert.match(stripTerminalSequences(row.render(80)[1]!), /^read /);
    const message = new AssistantMessageComponent(final as any, true);
    message.setOutputPad(0);
    const stats = message.render(80).map(stripTerminalSequences).find(line => line.includes("4 calls"));
    assert.match(stats!, /^4 calls /);
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
