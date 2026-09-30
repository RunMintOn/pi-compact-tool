import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testPng } from "./helpers/image.ts";
import {
  createBashToolDefinition, createEditToolDefinition, createReadToolDefinition, SessionManager,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { createDisplayTools } from "../src/tools.ts";

const cwd = () => mkdtempSync(join(tmpdir(), "pi-compact-tool-"));
const context = (path: string, extra = {}) => ({ cwd: path, sessionManager: SessionManager.inMemory(path), ...extra }) as unknown as ExtensionToolContext;

test("built-in metadata matches official definitions and does not auto-enable extra tools", () => {
  const tools = createDisplayTools(() => ({}));
  for (const official of [createReadToolDefinition(process.cwd()), createBashToolDefinition(process.cwd()), createEditToolDefinition(process.cwd())]) {
    const decorated = tools.find((tool) => tool.name === official.name)!;
    for (const key of ["name", "label", "description", "parameters", "prepareArguments", "outputSchema", "constrainedSampling", "promptSnippet", "promptGuidelines", "executionMode", "annotations"]) {
      assert.deepEqual((decorated as any)[key], (official as any)[key], key);
    }
    assert.equal(decorated.defaultActive, false);
    assert.equal("displaySummary" in (decorated.parameters as any).properties, false);
  }
});

test("Write, multiple Edit blocks and Read delegate to official tools in the actual context cwd", async () => {
  const path = cwd();
  const tools = new Map(createDisplayTools(() => ({})).map((tool) => [tool.name, tool]));
  const ctx = context(path);
  const writeResult = await tools.get("write")!.execute("write", { path: "sample.txt", content: "one\ntwo\nthree\n" }, undefined, undefined, ctx);
  assert.match((writeResult.content[0] as any).text, /Successfully/);
  const args = { path: "sample.txt", edits: [{ oldText: "one", newText: "ONE" }, { oldText: "three", newText: "THREE" }] };
  const editResult = await tools.get("edit")!.execute("edit", args, undefined, undefined, ctx);
  assert.match((editResult.details as any).diff, /ONE/);
  assert.equal(readFileSync(join(path, "sample.txt"), "utf8"), "ONE\ntwo\nTHREE\n");
  const readArgs = { path: "sample.txt", offset: 2, limit: 1 };
  assert.deepEqual(await tools.get("read")!.execute("read", readArgs, undefined, undefined, ctx),
    await createReadToolDefinition(path).execute("official", readArgs, undefined, undefined, ctx));
});

test("Bash respects effective shell prefix settings and forwards streaming updates", async () => {
  const path = cwd();
  let prefix = "export COMPACT_TEST_VALUE=first;";
  const tools = createDisplayTools(() => ({ shellPath: "/bin/bash", shellCommandPrefix: prefix }));
  const bash = tools.find((tool) => tool.name === "bash")!;
  const updates: any[] = [];
  const run = () => bash.execute("bash", { command: 'printf "$COMPACT_TEST_VALUE"' }, undefined, (update) => updates.push(update), context(path));
  assert.equal((await run()).content[0].type, "text");
  assert.equal((updates.at(-1)?.content[0] as any)?.text, "first");
  prefix = "export COMPACT_TEST_VALUE=second;";
  assert.equal(((await run()).content[0] as any).text, "second");
});

test("official cancellation and Read failures are not swallowed", async () => {
  const tools = createDisplayTools(() => ({}));
  const read = tools.find((tool) => tool.name === "read")!;
  const path = cwd();
  const aborted = AbortSignal.abort();
  await assert.rejects(read.execute("abort", { path: "missing" }, aborted, undefined, context(path)), /abort/i);
  await assert.rejects(read.execute("missing", { path: "missing" }, undefined, undefined, context(path)), /ENOENT/);
});

test("Read preserves image data and forwards model context", async () => {
  const path = cwd();
  writeFileSync(join(path, "test.png"), testPng());
  const tools = createDisplayTools(() => ({ images: { autoResize: false } }));
  const read = tools.find((tool) => tool.name === "read")!;
  const ctx = context(path, { model: { input: ["text"], inputLimits: { images: { resize: { maxWidth: 1, maxHeight: 1 } } } } });
  const args = { path: "test.png" };
  const result = await read.execute("image", args, undefined, undefined, ctx);
  assert.deepEqual(result, await createReadToolDefinition(path, { autoResizeImages: false }).execute("official", args, undefined, undefined, ctx));
  assert.ok(result.content.some((block) => block.type === "image"));
  assert.match((result.content[0] as any).text, /does not support images/);
});
