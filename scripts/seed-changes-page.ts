import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SessionManager, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { ChangeTracker } from "../src/changes.ts";
import { createDisplayTools } from "../src/tools.ts";

const cwd = await mkdtemp(join(tmpdir(), "pi-changes-demo-"));
const tracker = new ChangeTracker();
const tools = new Map(createDisplayTools(() => ({}), tracker).map(tool => [tool.name, tool]));
const ctx = { cwd, sessionManager: SessionManager.inMemory(cwd) } as unknown as ExtensionToolContext;
const run = (tool: string, args: unknown) => tools.get(tool)!.execute("demo", args, undefined, undefined, ctx);
await writeFile(join(cwd, "activity.ts"), Array.from({ length: 120 }, (_, i) => `export const metric${i} = ${i};`).join("\n") + "\n");
await writeFile(join(cwd, "settings.json"), '{\n  "theme": "light",\n  "legacy": true\n}\n');
tracker.start(cwd, Date.now() - 42000);
tracker.userMessage({ content: [{ type: "text", text: "增加本轮修改查看功能。\n\n请保留完整的用户消息，不需要模型生成摘要。页面需要文件侧边栏、单栏和双栏切换、自动明暗主题，以及 Wrap lines。\n\n特殊内容也应按普通文字显示：<script>window.injected = true</script>\n\n" + "这是较长的需求说明，用于检查用户消息区域能否折叠，以及展开后完整阅读。\n".repeat(12) }] });
await run("edit", { path: "activity.ts", edits: [
  { oldText: "export const metric2 = 2;", newText: "export const metric2 = 200;\nexport const changesLabel = 'View changes';" },
  { oldText: "export const metric45 = 45;", newText: "export const metric45 = 450;" },
  { oldText: "export const metric110 = 110;", newText: "export const metric110 = 1100;" },
] });
await run("write", { path: "settings.json", content: '{\n  "theme": "auto",\n  "layout": "auto"\n}\n' });
await run("write", { path: "新文件 <viewer>.ts", content: "export const welcome = '</script><script>window.injected = true</script>';\n" + "export const longMessage = '" + "This is a long line for checking side-by-side scrolling and line wrapping. ".repeat(20) + "';\n" });
const report = (await tracker.finish(Date.now(), "completed"))!;
assert.equal(report.files.length, 3);
assert.equal(report.prompts.length, 1);
const path = await tracker.save(report, process.argv[2] || join(tmpdir(), "pi-changes-demo-reports"));
console.log(JSON.stringify({ path, url: pathToFileURL(path).href, files: report.files.length, added: report.added, deleted: report.deleted }));
