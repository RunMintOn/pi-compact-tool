import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ChangeReport } from "./changes.ts";

const require = createRequire(import.meta.url);
let assets: { css: string; library: string; app: string; notices: string } | undefined;

export function renderChangesPage(report: ChangeReport): string {
  assets ??= {
    css: readFileSync(new URL("./changes-page.css", import.meta.url), "utf8"),
    // diffWords() pairs the removed and inserted text of a changed paragraph so
    // only the words that moved are marked. The rest of the page is plain DOM.
    library: readFileSync(join(dirname(require.resolve("diff/package.json")), "dist", "diff.min.js"), "utf8"),
    app: readFileSync(new URL("./changes-page.js", import.meta.url), "utf8"),
    notices: "jsdiff\n" + readFileSync(join(dirname(require.resolve("diff/package.json")), "LICENSE"), "utf8"),
  };
  const data = JSON.stringify(report).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Changes · pi-compact-tool</title>
<style>${assets.css}</style>
</head>
<!-- Bundled library notices\n${assets.notices.replace(/--/g, "- -")} -->
<body>
<header class="bar">
  <span class="brand">task changes</span>
  <span id="outcome" class="outcome"></span>
  <span id="metadata" class="meta"></span>
  <span class="position" id="position" aria-live="polite"></span>
  <div class="controls">
    <div class="segmented" role="group" aria-label="Change navigation">
      <button type="button" id="prev-change" title="Previous change (k)" aria-label="Previous change">↑</button>
      <button type="button" id="next-change" title="Next change (j)" aria-label="Next change">↓</button>
    </div>
    <button id="files-toggle" type="button" aria-expanded="false" aria-controls="sidebar">Files</button>
    <div class="segmented" role="group" aria-label="Diff layout">
      <button type="button" data-layout="unified" aria-pressed="true">Unified</button>
      <button type="button" data-layout="split" aria-pressed="false">Split</button>
    </div>
    <label class="wrap"><input id="wrap-lines" type="checkbox" checked> wrap</label>
  </div>
</header>
<div class="layout">
  <aside id="sidebar">
    <div class="aside-head"><h2>Files</h2><span id="file-count"></span></div>
    <nav id="file-list" aria-label="Changed files"></nav>
  </aside>
  <main id="main">
    ${report.incomplete ? '<p id="incomplete-notice" class="notice" role="status">Records may be incomplete: an apply_patch call failed or was interrupted. Only observed file changes are shown.</p>' : ""}
    <details id="user-messages" class="prompt"><summary>User message</summary><div id="prompts"></div></details>
    <div id="diffs"></div>
    <footer>Net changes in files touched by Edit / Write / apply_patch. Other file operations are not tracked.</footer>
  </main>
</div>
<script id="report-data" type="application/json">${data}</script>
<script>${assets.library.replace(/<\/script/gi, "<\\/script")}</script>
<script>${assets.app}</script>
</body>
</html>`;
}
