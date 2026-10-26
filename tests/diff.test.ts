import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { diffFile } from "../src/diff.ts";

/**
 * Checks the parser against the real file contents, using only the reported
 * line numbers. A row is correct when the text it claims sits at line N of that
 * file really is that text, which is independent of how the diff was built.
 */
function assertRowsMatchFiles(before: string, after: string, label: string): void {
  const strip = (text: string) => text.split("\n").map(line => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const oldLines = strip(before);
  const newLines = strip(after);
  const diff = diffFile("f", before, after);
  let added = 0;
  let deleted = 0;
  for (const block of diff.blocks) {
    let lastOld = block.oldStartLine - 1;
    let lastNew = block.newStartLine - 1;
    for (const line of block.lines) {
      if (line.type === "insert") {
        added++;
        assert.ok(!("oldNumber" in line), `${label}: an insert must not have an old number`);
        assert.equal(line.newNumber, lastNew + 1, `${label}: insert numbering is not contiguous`);
        assert.equal(newLines[line.newNumber - 1], line.content, `${label}: insert text does not match new line ${line.newNumber}`);
        lastNew = line.newNumber;
      } else if (line.type === "delete") {
        deleted++;
        assert.ok(!("newNumber" in line), `${label}: a delete must not have a new number`);
        assert.equal(line.oldNumber, lastOld + 1, `${label}: delete numbering is not contiguous`);
        assert.equal(oldLines[line.oldNumber - 1], line.content, `${label}: delete text does not match old line ${line.oldNumber}`);
        lastOld = line.oldNumber;
      } else {
        assert.equal(line.oldNumber, lastOld + 1, `${label}: context numbering is not contiguous`);
        assert.equal(line.newNumber, lastNew + 1, `${label}: context numbering is not contiguous`);
        assert.equal(oldLines[line.oldNumber - 1], line.content, `${label}: context text does not match old line ${line.oldNumber}`);
        assert.equal(newLines[line.newNumber - 1], line.content, `${label}: context text does not match new line ${line.newNumber}`);
        lastOld = line.oldNumber;
        lastNew = line.newNumber;
      }
      assert.doesNotMatch(line.content, /\r/, `${label}: a CR survived into the line body`);
    }
  }
  assert.equal(added, diff.addedLines, `${label}: added count disagrees with the rows`);
  assert.equal(deleted, diff.deletedLines, `${label}: deleted count disagrees with the rows`);
}

test("every reported row points at the text that is really on that line", () => {
  const root = new URL("../src/", import.meta.url).pathname;
  let checked = 0;
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".ts") && !name.endsWith(".js") && !name.endsWith(".css")) continue;
    const text = readFileSync(join(root, name), "utf8");
    if (text.includes("\u0000")) continue;
    checked++;
    assertRowsMatchFiles(text, text.replace("\n", "\n// probe\n"), `insert-${name}`);
    assertRowsMatchFiles(text, text.split("\n").filter((_, i) => i % 7 !== 3).join("\n"), `delete-${name}`);
    assertRowsMatchFiles(text, "", `clear-${name}`);
    assertRowsMatchFiles("", text, `create-${name}`);
  }
  assert.ok(checked > 5, "expected several real files to diff");
});

test("edge cases keep numbering correct instead of leaking patch syntax", () => {
  const cases: Array<[string, string, string]> = [
    ["missing trailing newline", "a\nb", "a\nc"],
    ["no trailing newline on either side", "a", "b"],
    ["crlf", "a\r\nb\r\n", "a\r\nc\r\n"],
    ["unchanged", "a\n", "a\n"],
    ["whitespace only", "a\n", "a \n"],
    ["empty", "", ""],
    ["unicode", "中文\n", "中文改\n"],
    ["content that looks like a patch header", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n", "--- a/x\n+++ b/x\n@@ -1 +1 @@\nchanged\n"],
  ];
  for (const [label, before, after] of cases) assertRowsMatchFiles(before, after, label);
});

test("hunks stay separate and keep their own numbering", () => {
  const before = Array.from({ length: 60 }, (_, i) => `l${i}`).join("\n") + "\n";
  const after = Array.from({ length: 60 }, (_, i) => ([3, 30, 55].includes(i) ? "X" : `l${i}`)).join("\n") + "\n";
  const diff = diffFile("f", before, after);
  assert.equal(diff.blocks.length, 3, "three distant edits produce three hunks");
  assert.equal(diff.addedLines, 3);
  assert.equal(diff.deletedLines, 3);
  assert.match(diff.blocks[0]!.header, /^@@ -\d+,\d+ \+\d+,\d+ @@$/);
  assertRowsMatchFiles(before, after, "three hunks");
});

test("a file with no newline at the end reports no marker row", () => {
  const diff = diffFile("f", "a\nb", "a\nc\n");
  const rows = diff.blocks.flatMap(block => block.lines);
  assert.equal(rows.length, 3, "context, delete, insert only");
  assert.ok(rows.every(row => !row.content.startsWith("\\")));
});
