/**
 * File operations declared by an `apply_patch` body, in the order they appear.
 *
 * Both the change tracker and the compact display read the same helper headers;
 * they differ only in what they do with the result, so the parsing lives here.
 * Move targets are reported as their own operation: the tracker needs both ends
 * of a move, while the display pairs a move with the file it came from.
 */
export type PatchOperation =
  | { op: "add" | "update" | "delete"; path: string }
  | { op: "move"; path: string };

const fileHeader = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const moveHeader = /^\*\*\* Move to: (.+)$/;

export function patchOperations(patch: string): PatchOperation[] {
  const operations: PatchOperation[] = [];
  for (const raw of patch.split(/\r?\n/)) {
    // The helper trims trailing whitespace from header paths, so a path is only
    // complete after the same trim. A leading space means a diff context line,
    // which can quote a header without being one.
    const line = raw.trimEnd();
    const file = fileHeader.exec(line);
    if (file) {
      operations.push({ op: file[1]!.toLowerCase() as "add" | "update" | "delete", path: file[2]! });
      continue;
    }
    const move = moveHeader.exec(line);
    if (move) operations.push({ op: "move", path: move[1]! });
  }
  return operations;
}
