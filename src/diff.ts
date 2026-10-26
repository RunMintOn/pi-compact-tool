import { structuredPatch } from "diff";

/**
 * A diff, shaped for the report page. `content` is the line body with its
 * +/-/space marker already removed; line numbers are 1-based and only set on
 * the side the line exists in.
 */
export type DiffLine =
  | { type: "context"; oldNumber: number; newNumber: number; content: string }
  | { type: "delete"; oldNumber: number; content: string }
  | { type: "insert"; newNumber: number; content: string };

export interface DiffHunk {
  /** Rendered as `-12,9 +12,10` in the page. */
  header: string;
  oldStartLine: number;
  newStartLine: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  blocks: DiffHunk[];
  addedLines: number;
  deletedLines: number;
}

/**
 * Build the report's diff from two file contents.
 *
 * The input is always a patch we generated ourselves for a single file, so this
 * handles the shapes jsdiff emits rather than arbitrary git output: CRLF line
 * endings, `\ No newline at end of file` markers, and empty sides for created or
 * deleted files.
 */
export function diffFile(path: string, before: string, after: string, contextLines = 4): FileDiff {
  const patch = structuredPatch(path, path, before, after, "", "", { context: contextLines });
  const blocks: DiffHunk[] = [];
  let addedLines = 0;
  let deletedLines = 0;
  for (const hunk of patch.hunks) {
    let oldNumber = hunk.oldStart;
    let newNumber = hunk.newStart;
    const lines: DiffLine[] = [];
    for (const raw of hunk.lines) {
      // jsdiff appends this marker after a line that has no trailing newline. It
      // describes the file, not a line, so it must not become a diff row.
      if (raw.startsWith("\\")) continue;
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const marker = line[0] ?? " ";
      const content = line.slice(1);
      if (marker === "+") {
        lines.push({ type: "insert", newNumber: newNumber++, content });
        addedLines++;
      } else if (marker === "-") {
        lines.push({ type: "delete", oldNumber: oldNumber++, content });
        deletedLines++;
      } else {
        lines.push({ type: "context", oldNumber: oldNumber++, newNumber: newNumber++, content });
      }
    }
    blocks.push({
      header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      oldStartLine: hunk.oldStart,
      newStartLine: hunk.newStart,
      lines,
    });
  }
  return { path, blocks, addedLines, deletedLines };
}
