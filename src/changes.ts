import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { generateUnifiedPatch } from "@earendil-works/pi-coding-agent";
import { parse } from "diff2html";
import type { DiffFile } from "diff2html/lib/types.js";
import { renderChangesPage } from "./changes-page.ts";

export const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_RUN_BYTES = 16 * MAX_SNAPSHOT_BYTES;
export type ChangeOutcome = "completed" | "aborted" | "error";
export interface ChangedFile {
  path: string;
  status: "Added" | "Modified" | "Deleted" | "Unavailable";
  added: number;
  deleted: number;
  diff?: DiffFile;
  notice?: string;
}
export interface ChangeReport {
  id: string;
  cwd: string;
  start: number;
  end: number;
  outcome: ChangeOutcome;
  prompts: string[];
  files: ChangedFile[];
  added: number;
  deleted: number;
}
type Snapshot = { exists: boolean; content: string; notice?: string };
interface Run {
  cwd: string;
  start: number;
  prompts: string[];
  files: Map<string, Promise<Snapshot>>;
  bytes: number;
}

async function snapshot(path: string): Promise<Snapshot> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return { exists: true, content: "", notice: "Not a regular text file." };
    if (info.size > MAX_SNAPSHOT_BYTES) return { exists: true, content: "", notice: "Snapshot exceeds the 1 MiB file limit." };
    const handle = await open(path, "r");
    let buffer: Buffer;
    try {
      // Bound the read even if the file grows after stat().
      buffer = Buffer.alloc(info.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > info.size) return { exists: true, content: "", notice: "File changed while its snapshot was being read." };
      buffer = buffer.subarray(0, offset);
    } finally { await handle.close(); }
    if (buffer.includes(0)) return { exists: true, content: "", notice: "Binary file; text diff unavailable." };
    return { exists: true, content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, content: "" };
    return { exists: true, content: "", notice: `Snapshot unavailable: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function fileChange(path: string, before: Snapshot, after: Snapshot): ChangedFile | undefined {
  const notice = [before.notice && `Before: ${before.notice}`, after.notice && `After: ${after.notice}`].filter(Boolean).join(" ");
  if (notice) return { path, status: "Unavailable", added: 0, deleted: 0, notice };
  if (before.exists === after.exists && before.content === after.content) return undefined;
  // Parse a neutral filename, then attach the real name as data. Tabs/newlines in
  // user paths must not be interpreted as patch headers.
  const diff = parse(generateUnifiedPatch("snapshot", before.content, after.content))[0]!;
  diff.oldName = path; diff.newName = path;
  diff.isNew = !before.exists; diff.isDeleted = !after.exists;
  return {
    path, status: !before.exists ? "Added" : !after.exists ? "Deleted" : "Modified",
    added: diff.addedLines, deleted: diff.deletedLines, diff,
  };
}

/** Only keeps the first snapshot of files about to be written by our Edit/Write tools. */
export class ChangeTracker {
  private current?: Run;
  latestPage?: string;

  start(cwd: string, now: number): void {
    this.current ??= { cwd, start: now, prompts: [], files: new Map(), bytes: 0 };
  }
  userMessage(message: { content?: unknown }): void {
    if (!this.current) return;
    const content = message.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map(block =>
      block?.type === "text" ? block.text : block?.type === "image" ? `[Image: ${block.mimeType ?? "attachment"}]` : "",
    ).filter(Boolean).join("\n") : "";
    this.current.prompts.push(text);
  }
  async captureBefore(absolutePath: string): Promise<void> {
    const run = this.current;
    if (!run) return;
    const path = await realpath(absolutePath).catch(async () =>
      join(await realpath(dirname(absolutePath)).catch(() => dirname(absolutePath)), basename(absolutePath)),
    );
    let pending = run.files.get(path);
    if (!pending) {
      pending = (async () => {
        if (run.bytes >= MAX_RUN_BYTES) return { exists: true, content: "", notice: "Snapshot exceeds the 16 MiB task limit." };
        const value = await snapshot(path);
        const bytes = Buffer.byteLength(value.content);
        if (run.bytes + bytes > MAX_RUN_BYTES) return { exists: value.exists, content: "", notice: "Snapshot exceeds the 16 MiB task limit." };
        run.bytes += bytes;
        return value;
      })();
      run.files.set(path, pending);
    }
    await pending;
  }
  async finish(now: number, outcome: ChangeOutcome): Promise<ChangeReport | undefined> {
    const run = this.current;
    this.current = undefined;
    if (!run?.files.size) return undefined;
    const files: ChangedFile[] = [];
    const cwd = await realpath(run.cwd).catch(() => run.cwd);
    // Sequential final reads avoid opening all observed files at once.
    for (const [path, pending] of run.files) {
      const before = await pending;
      const after = await snapshot(path);
      const local = relative(cwd, path);
      const display = !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`) ? local : path;
      const change = fileChange(display, before, after);
      if (change) files.push(change);
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return {
      id: randomUUID(), cwd: run.cwd, start: run.start, end: now, outcome, prompts: run.prompts, files,
      added: files.reduce((sum, file) => sum + file.added, 0),
      deleted: files.reduce((sum, file) => sum + file.deleted, 0),
    };
  }
  async save(report: ChangeReport, directory: string): Promise<string> {
    const html = renderChangesPage(report);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${report.id}.html`);
    await writeFile(path, html, { encoding: "utf8", mode: 0o600, flag: "wx" });
    this.latestPage = path;
    return path;
  }
  reset(): void { this.current = undefined; this.latestPage = undefined; }
}
