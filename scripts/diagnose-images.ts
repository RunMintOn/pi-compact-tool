import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { AssistantMessageComponent, ToolExecutionComponent, createReadToolDefinition, initTheme } from "@earendil-works/pi-coding-agent";
const themeModule = await import(new URL("./modes/interactive/theme/theme.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
import { Container, Image, ScrollView, TuiAltScreen, setCapabilities, setCellDimensions, type Terminal } from "@earendil-works/pi-tui";
import { ActivityProjection, installActivityUI } from "../src/activity.ts";
import { decorateTool } from "../src/display.ts";
import { defaultPreferences, resetDisplayState } from "../src/state.ts";
import { testPng } from "../tests/helpers/image.ts";

// Real fullscreen layout/diff/image-upload path; terminal writes are counted, not displayed.
// This isolates Pi/plugin CPU work, not terminal decoding, GPU painting or input latency.
const data = (process.argv[2] ? readFileSync(process.argv[2]) : testPng()).toString("base64");
const count = Number(process.argv[3] ?? 80);
if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error("Image count must be 1..1000");
const frames = 60;
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
initTheme("dark", false);
const theme = themeModule.theme;
setCellDimensions({ widthPx: 8, heightPx: 16 });
const report: unknown[] = [];
for (const mode of ["native", "aggregate-show", "aggregate-hide"] as const) {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: false });
  resetDisplayState("aggregate", { ...defaultPreferences, showThinking: mode !== "aggregate-hide" });
  const projection = new ActivityProjection();
  const release = mode === "native" ? undefined : installActivityUI(projection, () => theme);
  let bytes = 0;
  let uploads = 0;
  const terminal: Terminal = {
    columns: 100, rows: 40, kittyProtocolActive: false,
    start() {}, stop() {}, async drainInput() {},
    write(text) { bytes += Buffer.byteLength(text); uploads += (text.match(/a=T,/g) ?? []).length; },
    moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
  };
  const ui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
  const document = new Container();
  const scroll = new ScrollView(document, { primary: true, scrollbar: "hidden" });
  const originalImageRender = Image.prototype.render;
  let imageRenders = 0;
  let imageCacheMisses = 0;
  const previousRows = new WeakMap<Image, string[]>();
  Image.prototype.render = function(width) {
    const rows = originalImageRender.call(this, width);
    imageRenders++;
    if (previousRows.get(this) !== rows) imageCacheMisses++;
    previousRows.set(this, rows);
    return rows;
  };
  try {
    const tools: ToolExecutionComponent[] = [];
    for (let index = 0; index < count; index++) {
      const id = `image-${index}`;
      const message = { role: "assistant", content: [{ type: "thinking", thinking: "inspect image" }, { type: "toolCall", id, name: "read", arguments: { path: `${id}.png` } }], timestamp: 1000 + index, stopReason: "toolUse", usage, api: "openai-completions", provider: "openai", model: "test" };
      projection.ingest(message as any);
      document.addChild(new AssistantMessageComponent(message as any, true));
      const definition = createReadToolDefinition(process.cwd());
      const tool = new ToolExecutionComponent("read", id, { path: `${id}.png` }, {}, mode === "native" ? definition : decorateTool(definition), { requestRender() {} } as any, process.cwd());
      tool.updateResult({ content: [{ type: "image", data, mimeType: "image/png" }], details: undefined, isError: false });
      tools.push(tool);
      document.addChild(tool);
    }
    ui.setLayoutRoot(scroll);
    ui.start();
    const coldStart = performance.now();
    ui.renderNow();
    const coldMs = performance.now() - coldStart;
    const coldImageCacheMisses = imageCacheMisses;
    const coldBytes = bytes;
    const coldUploads = uploads;
    imageRenders = 0; imageCacheMisses = 0; bytes = 0; uploads = 0;
    const timings: number[] = [];
    for (let index = 0; index < frames; index++) {
      scroll.scrollBy(index < frames / 2 ? 3 : -3);
      const start = performance.now();
      ui.renderNow();
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const steady = { imageRenders, imageCacheMisses, bytes, uploads };
    const beforeInvalidation = imageCacheMisses;
    for (const tool of tools) tool.invalidate();
    ui.renderNow();
    report.push({ mode, coldMs, coldImageCacheMisses, coldBytes, coldUploads, frames, medianMs: timings[Math.floor(frames / 2)], p95Ms: timings[Math.floor(frames * 0.95)], ...steady, imageCacheMissesAfterInvalidation: imageCacheMisses - beforeInvalidation });
  } finally {
    ui.stop();
    Image.prototype.render = originalImageRender;
    release?.();
  }
}
console.log(JSON.stringify({ image: process.argv[2] ?? "2x2 smoke fixture", imageBytes: Buffer.byteLength(data, "base64"), count, protocol: "kitty", columns: 100, rows: 40, node: process.version, results: report, limitation: "No real terminal image decode/painting or wheel-to-screen latency measurement; PNG only." }, null, 2));
