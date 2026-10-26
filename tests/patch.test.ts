import assert from "node:assert/strict";
import test from "node:test";
import { patchOperations } from "../src/patch.ts";

test("every file header is reported with its own operation, moves included", () => {
  const operations = patchOperations([
    "*** Begin Patch",
    "*** Add File: added.ts",
    "+hello",
    "*** Update File: src/旧.ts",
    "*** Move to: src/new.ts",
    "@@",
    "-old",
    "+new",
    "*** Delete File: gone.ts",
    "*** End Patch",
  ].join("\n"));
  assert.deepEqual(operations, [
    { op: "add", path: "added.ts" },
    { op: "update", path: "src/旧.ts" },
    { op: "move", path: "src/new.ts" },
    { op: "delete", path: "gone.ts" },
  ]);
});

test("a header quoted by a diff context line is not a file operation", () => {
  // A leading space makes the line patch content, not a header. The helper also
  // trims trailing whitespace from header paths.
  const operations = patchOperations([
    "*** Begin Patch",
    "*** Update File: file.txt \t",
    "@@",
    " *** Delete File: decoy.bin",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n"));
  assert.deepEqual(operations, [{ op: "update", path: "file.txt" }]);
});

test("a move without a preceding file header is still reported", () => {
  assert.deepEqual(patchOperations("*** Move to: orphan.ts"), [{ op: "move", path: "orphan.ts" }]);
});
