# pi-compact-tool (Project Three)

[简体中文](./README.zh-CN.md)

Switch between three tool display styles in Pi's TUI. Inspired by `pi-tidy-tools` (Project One) and [`pi-tool-display-intent`](https://github.com/zhcsyncer/pi-extensions/tree/main/packages/pi-tool-display-intent) (Reference Two). This is an independent implementation; neither reference extension is loaded.

- **aggregate** (default): tool-region thinking and single-line tools sharing a continuous background, left-aligned subdued headings for parallel groups, thinking in transcript order, and request statistics after the final answer.
- **tidy**: compact summaries inspired by Project One. Bash shows its first output line and remaining count; Edit shows change counts; Write shows completion.
- **claude**: `● Read(path)`, `● Bash(command)` and indented result summaries.
- In fullscreen mode, left-click a tool's title or text result to expand/collapse that row.
- Switching styles preserves row expansion, refreshes existing rows, and never re-executes a tool or requires reload.
- Expanded tool rows stay native: Edit uses Pi's diff and Write shows supplied content. Separately, `View changes` opens a whole-task net diff with file navigation, split/unified layouts and line wrapping.
- Images retain Pi's native rendering and do not follow text expansion.
- Aggregate Bash always shows received text line counts, including failures and empty output. Failed tool names and targets turn red without error text; counts and other summary suffixes stay muted. Expand for the full error. Tidy/Claude keep their original error summaries.

## Try it

Requires Pi **0.99.1 or a newer 0.x release**.

From this directory:

```bash
pi -ne -e ./index.ts --tui-mode fullscreen
```

`-ne` disables auto-loaded extensions while allowing this explicit extension. Load other extensions with additional `-e` arguments when needed.

Do not load Project One, Reference Two, or another extension that owns the same built-in tools at the same time. This extension overrides `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`, without activating tools that were previously inactive.

Execution delegates directly to Pi's official implementations. Schemas, prompt metadata and official tool metadata are retained. Cancellation signals, streaming callbacks and the complete execution context are forwarded. Effective shell and image settings are honored. No `displaySummary`, additional model requests, or tool-result transformations.

## Switch styles

```text
/tool-style          Cycle aggregate → tidy → claude
/tool-style aggregate Compact records and end-of-request statistics
/tool-style tidy     Project One's compact style
/tool-style claude   Project Three's Claude style
```

Existing rows refresh without changing their expansion. New sessions and reload restore the startup style; this version does not persist style choices.

Choose the startup style:

```bash
pi -ne -e ./index.ts --tui-mode fullscreen --compact-style tidy
```

`/compact` remains Pi's context-compaction command. `Ctrl+O` remains Pi's global expansion action; per-row fullscreen clicking is this extension's main interaction. Regular terminal-scrollback mode does not provide the same mouse interaction.

## Aggregate display preferences

```text
/codemode-view          Toggle A / B
/codemode-view compact  A: one collapsed codemode row (default)
/codemode-view calls    B: summary plus the complete native nested-call region
/tool-thinking         Toggle thinking visibility
/tool-thinking show    Show thinking (default, retaining native expansion)
/tool-thinking hide    Hide all thinking, including standalone and streaming runs
```

These independent preferences affect aggregate only. Changes refresh existing rows without changing per-tool expansion. B preserves the native expanded call region, including all calls, arguments, wrapping, status, duration, errors and costs, with live partial updates. Script and output remain hidden. Without nested calls, both modes remain single-line. Click the summary or any nested row to expand the entire codemode; collapse returns to the selected A/B mode. `Ctrl+O` retains native global expansion.

Hidden thinking leaves no `Thinking...` placeholder or blank rows. Serial tools stay contiguous, with spacing only around parallel sections. Model thinking settings and transcript content are untouched; showing thinking again retains its native expansion. Normal text, errors and final statistics remain visible. Tidy/Claude thinking is unchanged.

Commands automatically save to `getAgentDir()/extension-data/pi-compact-tool/preferences.json` (normally `~/.pi/agent/extension-data/pi-compact-tool/preferences.json`). Preferences are shared across projects and restored for new sessions and reload. First-use defaults are A + thinking shown. `/tool-style` remains non-persistent. A failed save reports an error without changing current preferences.

## View task changes

In TUI sessions, Edit / Write save the first pre-write snapshot of each touched file. Once the entire agent run settles, the extension reads only those files again and generates a self-contained HTML report. Repeated edits become one net diff; files restored to their original state are omitted. No repository scan or Git baseline is used. Official tools still own path resolution, edit semantics and the per-file mutation queue; capture runs inside their filesystem operation hooks without changing tool results or model context.

Aggregate's first statistics line adds **View changes** after the tool counts. Narrow terminals truncate the counts first and preserve the link; extremely narrow rows shorten its label to **Changes**. The date line is unchanged. Link opening depends on the terminal's OSC 8 support (regular mode may require Ctrl/Command-click). In any display style, use:

```text
/changes             Open the latest generated report from this session
```

The command waits for the active task to settle before opening the system browser. If browser launch fails, it prints the report's file URL.

Reports include the complete user message text in a collapsed **User message** section, any additional user messages observed in the same run, start/end times, completion state, net file counts and line totals. The left file list shows Added / Modified / Deleted / Unavailable and follows the current reading position. **Auto** chooses Split when the diff area is at least 900 px wide, otherwise Unified; **Split** and **Unified** override that choice. Switching layouts preserves the current file. **Wrap lines** folds long code lines. At narrow widths the file list opens through **Files**. Page colors follow the browser/system light or dark preference.

The report covers **files touched by this extension's Edit / Write tools**, including nested calls through those definitions. Bash-only files and other tools are not tracked. Final changes to already tracked files can include formatting, external edits or deletion. Interrupted/error runs retain the changes already made. Binary/invalid UTF-8 files, failed snapshots and files above 1 MiB are listed as Unavailable rather than treated as empty; initial snapshots have a 16 MiB task budget. Their unknown line counts are excluded from the totals.

HTML reports are saved below `getAgentDir()/extension-data/pi-compact-tool/changes/` (normally `~/.pi/agent/extension-data/pi-compact-tool/changes/`). They contain inline diff2html assets and need neither a server nor network access. Only HTML is retained; source snapshots are released after settlement. Links and the latest-report association are kept in memory for the current session/runtime; reload/session replacement does not restore them. Existing HTML files remain usable and are not automatically removed. Runs observed before this feature was loaded cannot be reconstructed. If all observed files return to their original state, the first line shows **No net changes** and no new report is generated.

## Grouping and statistics

Thinking does not define groups. Multi-call assistant messages define candidate parallel groups. Separate single-call messages have no heading even without thinking between them. Live `tool_execution_start/end` events distinguish overlapping dispatch from sequential execution. Any observed overlap marks the whole dispatch group, including members that end early; entirely sequential groups have no heading. This is tool scheduling, not CPU-level concurrency or per-call overlap intervals. Old sessions without events use same-message multi-call grouping, which cannot prove elapsed-time overlap.

Observed scheduling, Bash output line counts and request timing are stored in non-context custom entries for reload/replay, without changing model messages or tool results. Counts include failed calls. `turns` counts assistant messages, including the final answer. Request statistics follow the final answer; elapsed time is wall time, not the sum of tool durations. Old records without precise timing use message timestamps. Unfinished requests have no final summary. Statistics follow one blank separator without a panel background, starting directly with the call count rather than a `Tools` label and preserving native body padding.

Timing appears as `total 2m 10s (tools 1m 40s) · TPS 30.0 tok/s`. `tools` is the union of observed top-level tool intervals within the user request, not the sum of individual durations; parallel overlap counts once and nested calls are covered by their parent. These intervals include Pi's preparation, confirmation and result handling, not only Bash process time. Missing or invalid tool timing omits the tool duration rather than estimating it.

TPS sums assistant `usage.output` from the current `agent_end.messages` and divides by the seconds between `agent_start` and `agent_end` **minus the union of that run's tool intervals**, clipped to the run boundaries. Network, waiting and thinking outside tool intervals remain included; reasoning tokens are not split out. TPS measures that agent run while displayed tool duration and other counts remain request-scoped, including continuations. The new TPS is stored with a formula marker in the existing custom entry for reload. Old records can recover tool duration from complete intervals, but their old wall-time TPS is omitted. Missing starts or tool timing, non-positive remaining time or no output omit TPS. Only existing aggregate summaries gain these metrics; answer-only requests and notifications remain unchanged. Disable the standalone `tps.ts` to avoid duplicate notifications.

Cost appears as `$0.641` with three decimal places. It sums assistant `usage.cost.total` from the current user message through its completed answer, including intermediate model calls but excluding costs from earlier user messages. Each new user message starts a fresh sum. This uses Pi's recorded USD cost estimates without querying billing or calculating prices separately. Reload rebuilds the sum from message usage; records without cost data omit the amount.

Bash uses supplied native output data to exclude empty-output and exit-status notices, ignoring trailing newlines and terminal wrapping. For upstream truncation it uses output-line metadata and shows `truncated`, without reading the full-output file. Old sessions without recorded counts fall back to received text, which may include native status notices. There are no command-specific success-summary rules in aggregate mode.

Aggregate uses the prototype's subdued background and green/purple tool labels, adjusted for light/dark appearance and terminal color capability. Thinking is colored only when its continuous region contains tools; standalone thinking stays native. Panel thinking has one colored blank row above it, reusing outer top padding at the start, and connects directly to tools below. A single blank line separates their shared region from normal text; normal text remains uncolored and breaks the panel. Each region also has one colored padding row at its top and bottom. All tool names align with body text, respecting native `outputPad` (one column by default, or zero), without gutters or extra reserved marker space. Parallel groups have a subdued blue-gray `parallel · N calls` heading directly above their tools. One colored blank row separates sections when entering or leaving a parallel group, including adjacent parallel groups. Existing outer padding is reused at region boundaries. Serial tools remain tightly packed, and the background stays continuous across groups. Panel backgrounds are reapplied after embedded ANSI resets to avoid holes after truncation.

Reversible native tool `render/handleMouse` and assistant `render` patches remove intra-region per-tool spacing and append the transient summary. Installed only in TUI sessions and restored on reload/shutdown. Thinking content and expansion state remain native; background/layout wrappers forward clicks to the original MouseRegion. Only thinking rows receive the panel background in mixed thinking/text messages. Per-row tool expansion and image paths remain intact.

## Images

Pi keeps ownership of image protocols, display settings and conversion. An image can remain visible while its text result is collapsed, matching native Pi behavior. Actual pixel display depends on terminal support and Pi settings. In aggregate mode, images remain after their owning tool. A colored bottom-padding row closes the text panel before the image; if more tools follow in the same region, a colored top-padding row resumes the panel. Existing section padding is reused. Images are not relocated to the end of the tool region.

Aggregate caches painted text layout and hidden-thinking region IDs to avoid repeated truncation, coloring and filtering on each frame. Image protocols, conversion, uploads and native image caches are unchanged. See [display/performance validation](./checks/display-preferences-validation.md) for a 300-PNG fullscreen CPU comparison and its limits: real terminal image decoding/painting and perceived scroll latency were not measured.

## Custom tools

`ffgrep`, `fffind` and `codemode` are adapted automatically in TUI mode, without changes to their extension or registration code. Adapters live in `src/custom-tools.ts` and replace only the UI component's definition, never the registered/executing tool, schema, exposure or activation state. Shutdown/reload restores the native renderer.

FFF rows show pattern, path and `totalMatched` counts (matches for ffgrep, files for fffind), falling back to result-line counts for old results. Expand for full output. Codemode defaults to its first code line and nested-call count; aggregate B additionally shows the complete native nested-call region. Without nested calls it shows the first code line and output-line count excluding the native status header. Expansion preserves native script, nested-call statuses and output. Statistics count only top-level codemode calls; nested calls are not shown as independent parallel groups. None of these tools is enabled automatically.

Other custom tools retain their renderer unless opted in. Wrap the definition at its original registration site:

```ts
import { decorateTool } from "pi-compact-tool/display";

pi.registerTool(decorateTool(existingTool));
```

When using this source checkout directly, replace the import with the actual path to `src/display.ts`.

The default renderer uses a generic call summary and text output. Add a display adapter for tool-specific presentation, for another search tool:

```ts
pi.registerTool(decorateTool(existingSearchTool, {
  kind: "search",
  target: (args) => `${args.pattern ?? ""} in ${args.path ?? "."}`,
  summary: (result) => {
    const text = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.type === "text" ? block.text : "")
      .join("\n");
    return `${text.split("\n").filter(Boolean).length} result lines`;
  },
}));
```

Kinds: `generic`, `read`, `search`, `bash`, `edit`, and `write`. Native diffs are shown only for `edit` results already containing `details.diff`. Execution, schemas and model-facing metadata retain their original definitions. Adapters format supplied data only; they should not read files or execute tools. Opting in replaces the original renderer, including any specialized buttons or interactions.

This version does not include whole-Run collapse, a separate detail popup, model-written intents, Project One's tool-wide shortcuts, or its Markdown auto-expansion mode. Unwrapped custom tools retain their own display and spacing.

## Local checks

```bash
npm install --ignore-scripts --legacy-peer-deps
npm run check
npm run test:tui  # requires expect, python3 and pi
npm run test:display-tui  # A/B, clicks, thinking visibility and preference restoration
npm run test:changes-ui  # requires ego-browser; saves HTML, results and screenshots outside the worktree
```

Development requires Pi's host packages and `typebox` to resolve locally. Validation on this machine uses symlinks to the existing Pi installation, without installing a second Pi copy.

See [display/performance validation](./checks/display-preferences-validation.md) for the new preferences and multi-image diagnostics. See [changes validation](./checks/changes-validation.md) for net-diff tests and browser checks. See [polish validation](./checks/polish-validation.md) for spacing refinements, automatic custom adapters, 42 tests and real fullscreen checks. The earlier unified-panel implementation is recorded in [thinking validation](./checks/thinking-validation.md). Earlier parallel headings are recorded in [layout validation](./checks/parallel-heading-validation.md). Earlier background and padding changes are recorded in [visual fix validation](./checks/visual-fix-validation.md). The [first aggregate validation](./checks/aggregate-validation.md) is retained. The [original validation notes](./checks/project-3-validation.md) are retained for the previous per-tool implementation. Licensed under [MIT](./LICENSE).
