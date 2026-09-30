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
  format: document.querySelector("#diffs").dataset.format,
  files: document.querySelectorAll(".file-link").length,
  metadata: document.querySelector("#metadata").textContent,
  injected: Boolean(window.injected),
  overflow: document.documentElement.scrollWidth > innerWidth,
})));
assert.equal(results.at(-1).result.format, "side-by-side");
assert.equal(results.at(-1).result.files, 3);
assert.match(results.at(-1).result.metadata, /3 changed files · \+8 −5/);
assert.equal(results.at(-1).result.injected, false);
assert.equal(results.at(-1).result.overflow, false);
await page.screenshot({ path: `${directory}/light-split.png` });
console.log(await page.snapshot());

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
await page.click('loc=css:a[href="#file-2"]');
await page.waitForFunction(() => document.querySelector('[aria-current="true"]')?.getAttribute("href") === "#file-2");
await page.click("loc=css:#wrap-lines");
record("wrapped split", await page.evaluate(() => ({
  selected: document.querySelector('[aria-current="true"]').getAttribute("href"),
  top: document.querySelector("#file-2").getBoundingClientRect().top,
  panes: [...document.querySelectorAll("#file-2 .d2h-file-side-diff")].map(pane => ({ width: pane.clientWidth, scroll: pane.scrollWidth })),
  wrapping: getComputedStyle(document.querySelector("#file-2 .d2h-code-line-ctn")).whiteSpace,
})));
assert.equal(results.at(-1).result.selected, "#file-2");
assert.equal(results.at(-1).result.wrapping, "pre-wrap");
assert.ok(results.at(-1).result.panes.every(pane => pane.scroll <= pane.width + 1));
await page.click('loc=css:button[data-layout="unified"]');
record("layout preserves position", await page.evaluate(() => ({
  format: document.querySelector("#diffs").dataset.format,
  selected: document.querySelector('[aria-current="true"]').getAttribute("href"),
  top: document.querySelector("#file-2").getBoundingClientRect().top,
  wrap: document.querySelector("#diffs").classList.contains("wrap-lines"),
})));
assert.equal(results.at(-1).result.format, "line-by-line");
assert.equal(results.at(-1).result.selected, "#file-2");
assert.ok(Math.abs(results.at(-1).result.top - results.at(-2).result.top) < 3);
assert.equal(results.at(-1).result.wrap, true);
await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
record("dark theme", await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
assert.equal(results.at(-1).result, "rgb(20, 23, 29)");
await page.screenshot({ path: `${directory}/dark-unified-wrap.png` });

await page.click('loc=css:button[data-layout="auto"]');
await viewport(600);
await page.waitForFunction(() => document.querySelector("#diffs").dataset.format === "line-by-line");
record("narrow auto", await page.evaluate(() => ({
  sidebar: getComputedStyle(document.querySelector("#sidebar")).display,
  overflow: document.documentElement.scrollWidth > innerWidth,
  format: document.querySelector("#diffs").dataset.format,
})));
assert.equal(results.at(-1).result.sidebar, "none");
assert.equal(results.at(-1).result.overflow, false);
await page.click("loc=css:#files-toggle");
await page.click('loc=css:a[href="#file-1"]');
await page.waitForFunction(() => !document.body.classList.contains("files-open") && document.querySelector('[aria-current="true"]')?.getAttribute("href") === "#file-1");
await page.screenshot({ path: `${directory}/narrow-unified.png` });
await page.click('loc=css:button[data-layout="split"]');
await viewport(640);
assert.equal(await page.evaluate(() => document.querySelector("#diffs").dataset.format), "side-by-side");
await page.click('loc=css:button[data-layout="auto"]');
await viewport(1600);
await page.waitForFunction(() => document.querySelector("#diffs").dataset.format === "side-by-side");
record("manual override and auto restore", "passed");
await fs.writeFile(`${directory}/results.json`, JSON.stringify(results, null, 2));
console.log({ passed: results.length, artifacts: directory, report: fixture.url });
await task.finish({ keep: [] });
EOF
} | ego-browser nodejs
