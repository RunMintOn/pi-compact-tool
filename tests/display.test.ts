import assert from "node:assert/strict";
import test from "node:test";
import {
  createBashToolDefinition, createEditToolDefinition, createReadToolDefinition,
  createWriteToolDefinition, initTheme, ToolExecutionComponent,
  type ExtensionToolContext, type Theme, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities, visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { testPng } from "./helpers/image.ts";
import { decorateTool } from "../src/display.ts";
import { resetDisplayState, setDisplayStyle, setToolColor, type DisplayContext } from "../src/state.ts";

initTheme("dark", false);
const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
const plain = (text: string) => text.replace(/\x1b\[[0-9;:]*m/g, "");
function context(args: unknown, expanded = false): DisplayContext {
  return { args, expanded, state: {}, toolCallId: "call", invalidate() {}, lastComponent: undefined,
    cwd: process.cwd(), executionStarted: true, argsComplete: true, isPartial: false, isError: false, showImages: true,
    durationMs: undefined, outputPad: 1 };
}
function render<T extends TSchema, D, S>(tool: ToolDefinition<T, D, S>, args: any, result: any, expanded = false, width = 100, error = false): string[] {
  const ctx: any = context(args, expanded);
  ctx.isError = error;
  const call = tool.renderCall!(args, theme, ctx);
  const output = tool.renderResult!(result, { expanded, isPartial: false }, theme, ctx);
  return [...call.render(width), ...output.render(width)].map(plain);
}
const output = { content: [{ type: "text" as const, text: "first\nsecond\nthird" }], details: undefined };

test("decorating a custom tool changes only rendering properties", async () => {
  const expected = { content: [{ type: "text" as const, text: "original" }], details: { untouched: true } };
  const parameters = { type: "object", properties: { query: { type: "string" } } };
  const signal = new AbortController().signal;
  const updates: unknown[] = [];
  const ctx = { cwd: "/tmp", model: { id: "test" } } as unknown as ExtensionToolContext;
  const onUpdate = (value: unknown) => { updates.push(value); };
  const original = {
    name: "custom_search", label: "Custom", description: "original description", parameters,
    outputSchema: { type: "object" }, promptSnippet: "search", promptGuidelines: ["original"],
    constrainedSampling: { type: "json_schema", strict: "prefer" }, exposure: "deferred",
    namespace: { name: "custom", description: "custom" }, annotations: { readOnlyHint: true },
    prepareArguments: (args: unknown) => args, executionMode: "parallel", defaultActive: false,
    async execute(...args: unknown[]) {
      assert.deepEqual(args, ["id", { query: "q" }, signal, onUpdate, ctx]);
      onUpdate(expected);
      return expected;
    },
  } as unknown as ToolDefinition<any>;
  const decorated = decorateTool(original);
  for (const key of Object.keys(original)) {
    if (!["renderCall", "renderResult", "renderShell"].includes(key)) {
      assert.equal((decorated as any)[key], (original as any)[key], key);
    }
  }
  assert.equal(original.renderCall, undefined);
  assert.equal(await decorated.execute("id", { query: "q" }, signal, onUpdate as any, ctx), expected);
  assert.deepEqual(updates, [expected]);
});

test("custom execute exceptions keep their identity", async () => {
  const original = createReadToolDefinition(process.cwd());
  const failure = new Error("original failure");
  original.execute = async () => { throw failure; };
  const decorated = decorateTool(original);
  await assert.rejects(decorated.execute("id", { path: "x" }, undefined, undefined, {} as ExtensionToolContext), (error) => error === failure);
});

test("tidy Bash keeps first output and inline remaining count", () => {
  resetDisplayState("tidy");
  const tool = decorateTool(createBashToolDefinition(process.cwd()), { kind: "bash" });
  const rows = render(tool, { command: "printf test" }, output);
  assert.match(rows.join("\n"), /\$ printf test/);
  assert.match(rows.join("\n"), /first.*2 more lines/);
  assert.doesNotMatch(rows.join("\n"), /second/);
});

test("Claude style uses a target call and summary without intent fields", () => {
  resetDisplayState("claude");
  const tool = decorateTool(createReadToolDefinition(process.cwd()), { kind: "read" });
  const rows = render(tool, { path: "hello.ts", offset: 2, limit: 3 }, output);
  assert.match(rows.join("\n"), /Read\(hello.ts:2-4\)/);
  assert.match(rows.join("\n"), /⎿.*loaded 3 lines/);
  assert.equal("displaySummary" in (tool.parameters as any).properties, false);
});

test("errors remain visible in both styles and never become success summaries", () => {
  for (const style of ["tidy", "claude"] as const) {
    resetDisplayState(style);
    for (const kind of ["read", "search", "generic"] as const) {
      const tool = decorateTool(createReadToolDefinition(process.cwd()), { kind });
      const rows = render(tool, { path: "missing" }, { content: [{ type: "text", text: "ENOENT: missing file\nstack line" }], details: undefined }, false, 100, true);
      assert.match(rows.join("\n"), /ENOENT/);
      assert.doesNotMatch(rows.join("\n"), /loaded|applied|done/);
    }
  }
});

test("expanded Edit uses returned diff, not filesystem previews", () => {
  resetDisplayState("claude");
  const original = createEditToolDefinition(process.cwd());
  original.renderCall = () => { throw new Error("preview renderer must not be called"); };
  const tool = decorateTool(original, { kind: "edit" });
  const rows = render(tool, { path: "file-that-does-not-exist.ts", edits: [{ oldText: "old", newText: "new" }] }, {
    content: [{ type: "text", text: "Successfully replaced text" }], details: { diff: "-1 old\n+1 new", firstChangedLine: 1 },
  }, true);
  assert.match(rows.join("\n"), /old/);
  assert.match(rows.join("\n"), /new/);
});

test("expanded Write displays supplied content without reading the path", () => {
  resetDisplayState("tidy");
  const tool = decorateTool(createWriteToolDefinition(process.cwd()), { kind: "write" });
  const rows = render(tool, { path: "/does/not/exist/sample.txt", content: "unique body\nlast line" }, { content: [{ type: "text", text: "Success" }], details: undefined }, true);
  assert.match(rows.join("\n"), /unique body/);
  assert.match(rows.join("\n"), /last line/);
});

test("width-aware summaries fit narrow terminals, Chinese, emoji and tabs", () => {
  for (const style of ["tidy", "claude"] as const) {
    resetDisplayState(style);
    const tool = decorateTool(createBashToolDefinition(process.cwd()), { kind: "bash" });
    for (const width of [1, 2, 5, 20, 80]) {
      const rows = render(tool, { command: "printf 中文😀\tvery-long-command" }, output, false, width);
      assert.ok(rows.every((row) => visibleWidth(row) <= width), JSON.stringify({ width, rows }));
    }
  }
});

test("custom adapters format target and summary without touching parameters or results", () => {
  resetDisplayState("claude");
  const tool = decorateTool({ ...createReadToolDefinition(process.cwd()), name: "ffgrep" }, {
    kind: "search", target: (args) => String(args.pattern), summary: () => "3 matches",
  });
  const args = { pattern: "needle", path: "src/" };
  const before = JSON.stringify({ args, output });
  assert.match(render(tool, args, output).join("\n"), /ffgrep\(needle\)/);
  assert.match(render(tool, args, output).join("\n"), /3 matches/);
  assert.equal(JSON.stringify({ args, output }), before);
});

test("switching styles invalidates existing rows without altering their expansion", () => {
  resetDisplayState("tidy");
  const tool = decorateTool(createBashToolDefinition(process.cwd()), { kind: "bash" });
  const ctx: any = context({ command: "echo x" }, true);
  let invalidations = 0;
  ctx.invalidate = () => { invalidations++; };
  tool.renderCall!(ctx.args as any, theme, ctx);
  tool.renderResult!(output, { expanded: true, isPartial: false }, theme, ctx as any);
  setDisplayStyle("claude");
  assert.equal(invalidations, 1);
  assert.equal(ctx.expanded, true);
  assert.match(plain(tool.renderCall!(ctx.args as any, theme, ctx).render(80).join("\n")), /Bash\(echo x\)/);
});

test("the real Pi tool component supports per-row click and live style switching", () => {
  resetDisplayState("tidy");
  let requests = 0;
  const tool = decorateTool(createReadToolDefinition(process.cwd()), { kind: "read" });
  const row = new ToolExecutionComponent("read", "click-test", { path: "x" }, {}, tool, { requestRender() { requests++; } } as any, process.cwd());
  row.setArgsComplete();
  row.updateResult({ ...output, isError: false });
  const collapsed = plain(row.render(100).join("\n"));
  assert.doesNotMatch(collapsed, /second/);
  const event = { type: "click", button: "left", x: 3, y: 2, width: 100, height: row.render(100).length } as TuiMouseEvent;
  assert.equal(row.handleMouse(event)?.handled, true);
  assert.match(plain(row.render(100).join("\n")), /second/);
  setDisplayStyle("claude");
  assert.match(plain(row.render(100).join("\n")), /Read\(x\)/);
  assert.match(plain(row.render(100).join("\n")), /second/);
  assert.ok(requests > 0);
  assert.equal(row.handleMouse(event)?.handled, true);
  assert.doesNotMatch(plain(row.render(100).join("\n")), /second/);
});

test("tool color previews adapt to light themes, preserve failure colors and leave other styles unchanged", () => {
  resetDisplayState("aggregate");
  initTheme("light", false);
  try {
    const definition = decorateTool(createBashToolDefinition(process.cwd()));
    const row = new ToolExecutionComponent("bash", "light-color", { command: "echo test" }, {}, definition, { requestRender() {} } as any, process.cwd());
    row.updateResult({ ...output, isError: false });
    setToolColor("bash", "amber");
    assert.match(row.render(80).join("\n"), /\x1b\[38;2;145;99;21mbash/);
    setDisplayStyle("tidy");
    const tidy = row.render(80).join("\n");
    setToolColor("bash", "pink");
    assert.equal(row.render(80).join("\n"), tidy);
    setDisplayStyle("claude");
    const claude = row.render(80).join("\n");
    setToolColor("bash", "blue");
    assert.equal(row.render(80).join("\n"), claude);
    setDisplayStyle("aggregate");
    row.updateResult({ ...output, isError: true });
    const failed = row.render(80).join("\n");
    setToolColor("bash", "cyan");
    assert.equal(row.render(80).join("\n"), failed);
  } finally { initTheme("dark", false); resetDisplayState("aggregate"); }
});

test("multiline commands stay on one collapsed row", () => {
  resetDisplayState("claude");
  const tool = decorateTool(createBashToolDefinition(process.cwd()));
  const rows = render(tool, { command: "echo one\necho two" }, output);
  assert.ok(rows.every((row) => !row.includes("\n")));
  assert.match(rows.join("\n"), /↵/);
});

test("native image protocol output is preserved across both styles and expansion states", () => {
  const capabilities = getCapabilities();
  setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: false });
  try {
    resetDisplayState("claude");
    const tool = decorateTool(createReadToolDefinition(process.cwd()));
    const row = new ToolExecutionComponent("read", "image-row", { path: "image.png" }, {}, tool, { requestRender() {} } as any, process.cwd());
    row.updateResult({ content: [{ type: "image", data: testPng().toString("base64"), mimeType: "image/png" }], details: undefined, isError: false });
    for (const style of ["tidy", "claude"] as const) {
      setDisplayStyle(style);
      for (const expanded of [false, true]) {
        row.setExpanded(expanded);
        assert.match(row.render(100).join("\n"), /\x1b\]1337;File=/);
      }
    }
    row.setShowImages(false);
    assert.doesNotMatch(row.render(100).join("\n"), /\x1b\]1337;File=/);
  } finally { setCapabilities(capabilities); }
});

test("partial results remain renderable, and truncated output is disclosed", () => {
  resetDisplayState("claude");
  const tool = decorateTool(createBashToolDefinition(process.cwd()), { kind: "bash" });
  const ctx = context({ command: "build" });
  ctx.isPartial = true;
  const result = { ...output, details: { truncation: { truncated: true }, fullOutputPath: "/tmp/full-output" } };
  assert.match(tool.renderResult!(result as any, { expanded: false, isPartial: true }, theme, ctx as any).render(100).join("\n"), /first/);
  assert.match(render(tool, ctx.args, result).join("\n"), /truncated/);
  assert.match(render(tool, ctx.args, result, true).join("\n"), /\/tmp\/full-output/);
});
