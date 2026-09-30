import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { ACTIVITY_ENTRY, ActivityProjection } from "../src/activity.ts";
import { createDisplayTools } from "../src/tools.ts";
import { testPng } from "../tests/helpers/image.ts";

// Replay actual local tool outputs and explicit parallel/serial events, without a model request.
const root = mkdtempSync(join(tmpdir(), "pi-compact-tui-"));
const cwd = join(root, "workspace");
const agentDir = join(root, "agent");
mkdirSync(cwd); mkdirSync(agentDir);
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ quietStartup: true, collapseChangelog: true, hideThinkingBlock: true, terminal: { showImages: false }, enableAnalytics: false, enableInstallTelemetry: false }));
writeFileSync(join(cwd, "image.png"), testPng());
const manager = SessionManager.create(cwd, join(root, "sessions"));
const projection = new ActivityProjection();
const tools = new Map(createDisplayTools(() => ({})).map(tool => [tool.name, tool]));
const usage = { input: 0, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
type Message = Parameters<SessionManager["appendMessage"]>[0];
const messages: Message[] = [];
function append(message: Message) { messages.push(message); manager.appendMessage(message); projection.ingest(message); }
projection.agentStarted(Date.now());
append({ role: "user", content: "本地 TUI 验证：实际工具结果，没有模型请求。", timestamp: Date.now() });
type Call = { id: string; name: string; args: Record<string, string | Array<{ oldText: string; newText: string }>> };
async function batch(calls: Call[], thinking?: string) {
  append({ role: "assistant", content: [
    ...(thinking ? [{ type: "thinking" as const, thinking }] : []),
    ...calls.map(call => ({ type: "toolCall" as const, id: call.id, name: call.name, arguments: call.args })),
  ], api: "openai-completions", provider: "openai", model: "gpt-4o", usage, stopReason: "toolUse", timestamp: Date.now() });
  const results = await Promise.all(calls.map(async call => {
    projection.started(call.id, Date.now());
    const ctx = { cwd, sessionManager: manager } as unknown as ExtensionToolContext;
    let result;
    let isError = false;
    try { result = await tools.get(call.name)!.execute(call.id, call.args, undefined, undefined, ctx); }
    catch (error) { isError = true; result = { content: [{ type: "text" as const, text: String(error) }], details: undefined }; }
    projection.ended(call.id, Date.now(), call.name === "bash" ? result : undefined);
    return { role: "toolResult" as const, toolCallId: call.id, toolName: call.name, ...result, isError, timestamp: Date.now() };
  }));
  for (const result of results) append(result as Message);
}
await batch([{ id: "local-write", name: "write", args: { path: "sample.txt", content: "one\ntwo\nthree\n" } }], "先创建验证文件。展开后应该能看到这段思考文字。");
await batch([{ id: "local-edit", name: "edit", args: { path: "sample.txt", edits: [{ oldText: "two", newText: "TWO" }] } }]);
// No thinking between two distinct single-call messages.
await batch([{ id: "local-bash", name: "bash", args: { command: "printf 'first\\nsecond\\nthird\\n'" } }]);
await batch([
  { id: "local-image", name: "read", args: { path: "image.png" } },
  { id: "local-missing", name: "read", args: { path: "missing.txt" } },
  { id: "local-read", name: "read", args: { path: "sample.txt" } },
], "下面三个 Read 是一次并行调用，前面应有 parallel 标题。");
const final: Message = { role: "assistant", content: [{ type: "text", text: "验证结束。FINAL ANSWER：统计应在这段回答之后。" }], api: "openai-completions", provider: "openai", model: "gpt-4o", usage, stopReason: "stop", timestamp: Date.now() };
append(final);
projection.completed(final, Date.now());
projection.agentEnded(messages, Date.now());
manager.appendCustomEntry(ACTIVITY_ENTRY, projection.timingRecord());
console.log(JSON.stringify({ cwd, agentDir, session: manager.getSessionFile() }));
