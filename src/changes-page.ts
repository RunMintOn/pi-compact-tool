import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ChangeReport } from "./changes.ts";

const require = createRequire(import.meta.url);
const vendorRequire = createRequire(require.resolve("diff2html"));
let assets: { css: string; library: string; app: string; notices: string } | undefined;

export function renderChangesPage(report: ChangeReport): string {
  assets ??= {
    css: readFileSync(require.resolve("diff2html/bundles/css/diff2html.min.css"), "utf8") + "\n" + readFileSync(new URL("./changes-page.css", import.meta.url), "utf8"),
    library: readFileSync(require.resolve("diff2html/bundles/js/diff2html.min.js"), "utf8"),
    app: readFileSync(new URL("./changes-page.js", import.meta.url), "utf8"),
    notices: [
      "diff2html\n" + readFileSync(require.resolve("diff2html/LICENSE.md"), "utf8"),
      "jsdiff\n" + readFileSync(join(dirname(vendorRequire.resolve("diff/package.json")), "LICENSE"), "utf8"),
      "Hogan · Copyright 2011 Twitter, Inc.\n" + readFileSync(vendorRequire.resolve("@profoundlogic/hogan/LICENSE"), "utf8"),
    ].join("\n\n"),
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
<header class="report-header">
  <div class="heading"><h1>Task changes</h1><span id="outcome" class="badge"></span></div>
  <div id="metadata" class="metadata"></div>
  <p class="scope">Net changes in files touched by Edit / Write. Other file operations are not tracked.</p>
  <details id="user-messages"><summary>User message</summary><div id="prompts"></div></details>
</header>
<div class="layout">
  <aside id="sidebar"><h2>Files <span id="file-count"></span></h2><nav id="file-list" aria-label="Changed files"></nav></aside>
  <main id="main">
    <div class="toolbar">
      <button id="files-toggle" type="button" aria-expanded="false" aria-controls="sidebar">Files</button>
      <div class="layout-buttons" role="group" aria-label="Diff layout">
        <button type="button" data-layout="auto" aria-pressed="true">Auto</button>
        <button type="button" data-layout="split" aria-pressed="false">Split</button>
        <button type="button" data-layout="unified" aria-pressed="false">Unified</button>
      </div>
      <label class="wrap-toggle"><input id="wrap-lines" type="checkbox"> Wrap lines</label>
    </div>
    <div id="diffs"></div>
  </main>
</div>
<footer>Generated locally by pi-compact-tool · Diff rendering by diff2html (MIT)</footer>
<script id="report-data" type="application/json">${data}</script>
<script>${assets.library.replace(/<\/script/gi, "<\\/script")}</script>
<script>${assets.app}</script>
</body>
</html>`;
}
