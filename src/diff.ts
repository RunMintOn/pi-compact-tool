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
  oldStartLine: number;
  oldLineCount: number;
  newStartLine: number;
  newLineCount: number;
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
 *
 * The page folds long unchanged runs, but jsdiff caps a run at twice this context
 * on either side of a change, so the default is well above the page's fold
 * threshold; at 4 nearly every run is too short to fold.
 */
export function diffFile(path: string, before: string, after: string, contextLines = 10): FileDiff {
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
      oldStartLine: hunk.oldStart,
      oldLineCount: hunk.oldLines,
      newStartLine: hunk.newStart,
      newLineCount: hunk.newLines,
      lines,
    });
  }
  return { path, blocks, addedLines, deletedLines };
}
