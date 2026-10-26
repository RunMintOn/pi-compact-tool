#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PI_CHANGES_QA_DIR="${PI_CHANGES_QA_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/pi-changes-browser.XXXXXX")}"
mkdir -p "$PI_CHANGES_QA_DIR"
node --import tsx scripts/seed-changes-page.ts "$PI_CHANGES_QA_DIR" > "$PI_CHANGES_QA_DIR/fixture.json"
{
printf 'const qaConfig = %s;\n' "$(node -e 'console.log(JSON.stringify({ directory: process.env.PI_CHANGES_QA_DIR, space: process.env.PI_CHANGES_QA_SPACE ? Number(process.env.PI_CHANGES_QA_SPACE) : null }))')"
cat <<'EOF'
const { strict: assert } = await import("node:assert");
const fs = await import("node:fs/promises");
const directory = qaConfig.directory;
const fixture = JSON.parse(await fs.readFile(`${directory}/fixture.json`, "utf8"));
const task = await taskSpace(qaConfig.space ?? "pi compact changes viewer QA");
const page = task.page("p1");
const results = [];
const record = (name, result) => results.push({ name, result });
const viewport = (width, height = 1000) => page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
await viewport(1440);
await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await page.goto(fixture.url);
await page.waitForSelector("#diffs .file-section");
record("initial", await page.evaluate(() => ({
  layout: document.querySelector("#diffs").dataset.layout,
  files: document.querySelectorAll(".file-link").length,
  kinds: [...document.querySelectorAll(".kind")].map(kind => kind.textContent),
  firstFile: document.querySelector(".file-link .file-name")?.textContent,
  metadata: document.querySelector("#metadata").textContent,
  injected: Boolean(window.injected),
  overflow: document.documentElement.scrollWidth > innerWidth,
})));
assert.equal(results.at(-1).result.layout, "unified");
assert.equal(results.at(-1).result.files, 4);
// The seed mixes markdown with other files, so the sidebar splits in two.
assert.deepEqual(results.at(-1).result.kinds, ["Markdown· 1", "Other· 3"]);
// Markdown leads the list even though it sorts last by path.
assert.equal(results.at(-1).result.firstFile, "NOTES.md");
assert.match(results.at(-1).result.metadata, /^4 files · \+10 −6 · /);
assert.equal(results.at(-1).result.injected, false);
assert.equal(results.at(-1).result.overflow, false);
await page.screenshot({ path: `${directory}/light-unified.png` });
console.log(await page.snapshot());

// A changed paragraph marks only the words that moved instead of the whole line,
// and the source text stays verbatim.
record("word level marks", await page.evaluate(() => ({
  marked: document.querySelectorAll("#file-0 .hl-i").length,
  removed: document.querySelectorAll("#file-0 .hl-d").length,
  keepsSource: [...document.querySelectorAll("#file-0 td.content")].some(cell => cell.textContent.includes("export const metric2")),
})));
assert.ok(results.at(-1).result.marked > 0);
assert.ok(results.at(-1).result.removed > 0);
assert.equal(results.at(-1).result.keepsSource, true);

await page.click("loc=css:#user-messages summary");
record("full user message", await page.evaluate(() => ({
  open: document.querySelector("#user-messages").open,
  text: document.querySelector("#prompts").textContent,
  height: document.querySelector("#prompts").clientHeight,
  injected: Boolean(window.injected),
})));
assert.equal(results.at(-1).result.open, true);
assert.match(results.at(-1).result.text, /<script>window.injected = true<\/script>/);
assert.match(results.at(-1).result.text, /这是较长的需求说明/);
assert.ok(results.at(-1).result.height <= 260);
assert.equal(results.at(-1).result.injected, false);
await page.click("loc=css:#user-messages summary");

// Wrapping is on by default; turning it off must not create page-level overflow.
record("wrap toggle", await page.evaluate(() => ({
  on: !document.querySelector("#diffs").classList.contains("nowrap"),
  whiteSpace: getComputedStyle(document.querySelector("#file-0 td.content")).whiteSpace,
})));
assert.equal(results.at(-1).result.on, true);
assert.equal(results.at(-1).result.whiteSpace, "pre-wrap");
await page.click("loc=css:#wrap-lines");
record("nowrap scrolls inside the hunk", await page.evaluate(() => ({
  nowrap: document.querySelector("#diffs").classList.contains("nowrap"),
  pageOverflow: document.documentElement.scrollWidth > innerWidth,
  scroller: getComputedStyle(document.querySelector("#file-0 .scroll")).overflowX,
})));
assert.equal(results.at(-1).result.nowrap, true);
assert.equal(results.at(-1).result.pageOverflow, false);
assert.equal(results.at(-1).result.scroller, "auto");
await page.click("loc=css:#wrap-lines");

// Change navigation walks hunks, not files: one document can hold several.
const hunkState = () => page.evaluate(() => ({
  position: document.getElementById("position").textContent,
  current: [...document.querySelectorAll(".hunk")].findIndex(hunk => hunk.dataset.current === "true"),
  top: Math.round(document.querySelector('.hunk[data-current="true"]')?.getBoundingClientRect().top ?? -1),
}));
record("change navigation", await hunkState());
assert.match(results.at(-1).result.position, /^\d+ \/ \d+$/);
const totalHunks = Number(results.at(-1).result.position.split("/")[1].trim());
assert.ok(totalHunks > 1, "fixture has several hunks");
await page.click("loc=css:#next-change");
await page.waitForFunction(() => [...document.querySelectorAll(".hunk")].some(h => h.dataset.current === "true"));
record("next change", await hunkState());
assert.equal(results.at(-1).result.current, 0);
// The hunk header lands just below the sticky bar, not underneath it.
assert.ok(results.at(-1).result.top >= 40 && results.at(-1).result.top <= 62);
await page.click("loc=css:#next-change");
await page.waitForFunction(() => document.querySelectorAll('.hunk[data-current="true"]')[0] === document.querySelectorAll(".hunk")[1]);
record("second change", await hunkState());
assert.equal(results.at(-1).result.current, 1);
await page.keyboard.press("j");
await page.waitForFunction(() => document.querySelectorAll('.hunk[data-current="true"]')[0] === document.querySelectorAll(".hunk")[2]);
record("j advances", await hunkState());
assert.equal(results.at(-1).result.current, 2);
await page.keyboard.press("k");
await page.waitForFunction(() => document.querySelectorAll('.hunk[data-current="true"]')[0] === document.querySelectorAll(".hunk")[1]);
record("k retreats", await hunkState());
assert.equal(results.at(-1).result.current, 1);

// Navigate to the last file by display order, not by index.
const lastHref = await page.evaluate(() => [...document.querySelectorAll(".file-link")].at(-1).getAttribute("href"));
await page.click(`loc=css:a[href="${lastHref}"]`);
await page.waitForFunction(href => document.querySelector('[aria-current="true"]')?.getAttribute("href") === href, lastHref);
await page.click('loc=css:button[data-layout="split"]');
record("split keeps position", await page.evaluate(href => ({
  layout: document.querySelector("#diffs").dataset.layout,
  selected: document.querySelector('[aria-current="true"]').getAttribute("href"),
  // A context row carries one cell per side plus the gutter, so four cells mean
  // both columns rendered.
  columns: document.querySelectorAll("#file-0 tr.context td.content").length,
  gutter: document.querySelectorAll("#file-0 tr.context td.gutter").length,
}), lastHref));
assert.equal(results.at(-1).result.layout, "split");
assert.equal(results.at(-1).result.selected, lastHref);
assert.ok(results.at(-1).result.columns >= 4, "split renders both sides of a context row");
assert.ok(results.at(-1).result.gutter > 0, "split draws the divider gutter");
await page.screenshot({ path: `${directory}/light-split.png` });

await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
record("dark theme", await page.evaluate(() => ({
  page: getComputedStyle(document.body).backgroundColor,
  scheme: getComputedStyle(document.documentElement).colorScheme,
})));
assert.equal(results.at(-1).result.scheme, "dark");
assert.notEqual(results.at(-1).result.page, "rgb(255, 255, 255)");
await page.screenshot({ path: `${directory}/dark-split.png` });

await page.click('loc=css:button[data-layout="unified"]');
await viewport(600);
await page.waitForFunction(() => document.querySelector('button[data-layout="split"]').disabled);
record("narrow unified", await page.evaluate(() => ({
  sidebar: getComputedStyle(document.querySelector("#sidebar")).display,
  overflow: document.documentElement.scrollWidth > innerWidth,
  splitDisabled: document.querySelector('button[data-layout="split"]').disabled,
})));
assert.equal(results.at(-1).result.sidebar, "none");
assert.equal(results.at(-1).result.overflow, false);
assert.equal(results.at(-1).result.splitDisabled, true);
await page.click("loc=css:#files-toggle");
await page.click('loc=css:a[href="#file-1"]');
await page.waitForFunction(() => !document.body.classList.contains("files-open") && document.querySelector('[aria-current="true"]')?.getAttribute("href") === "#file-1");
await page.screenshot({ path: `${directory}/narrow-unified.png` });
await viewport(1600);
await page.waitForFunction(() => !document.querySelector('button[data-layout="split"]').disabled);
record("split re-enabled", "passed");

await fs.writeFile(`${directory}/results.json`, JSON.stringify(results, null, 2));
console.log({ passed: results.length, artifacts: directory, report: fixture.url });
await task.finish({ keep: [] });
EOF
} | ego-browser nodejs
