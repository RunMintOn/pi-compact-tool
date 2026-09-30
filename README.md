# pi-compact-tool (Project Three)

[简体中文](./README.zh-CN.md)

Switch between three tool display styles in Pi's TUI. Inspired by `pi-tidy-tools` (Project One) and [`pi-tool-display-intent`](https://github.com/zhcsyncer/pi-extensions/tree/main/packages/pi-tool-display-intent) (Reference Two). This is an independent implementation; neither reference extension is loaded.

- **aggregate** (default): tool-region thinking and single-line tools sharing a continuous background, left-aligned subdued headings for parallel groups, thinking in transcript order, and request statistics after the final answer.
- **tidy**: compact summaries inspired by Project One. Bash shows its first output line and remaining count; Edit shows change counts; Write shows completion.
- **claude**: `● Read(path)`, `● Bash(command)` and indented result summaries.
- In fullscreen mode, left-click a tool's title or text result to expand/collapse that row.
- Switching styles preserves row expansion, refreshes existing rows, and never re-executes a tool or requires reload.
- Expanded Edit uses Pi's native diff. Write shows supplied content. No custom side-by-side diff, pending previews, or reads of previous file contents.
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

## Grouping and statistics

Thinking does not define groups. Multi-call assistant messages define candidate parallel groups. Separate single-call messages have no heading even without thinking between them. Live `tool_execution_start/end` events distinguish overlapping dispatch from sequential execution. Any observed overlap marks the whole dispatch group, including members that end early; entirely sequential groups have no heading. This is tool scheduling, not CPU-level concurrency or per-call overlap intervals. Old sessions without events use same-message multi-call grouping, which cannot prove elapsed-time overlap.

Observed scheduling, Bash output line counts and request timing are stored in non-context custom entries for reload/replay, without changing model messages or tool results. Counts include failed calls. `turns` counts assistant messages, including the final answer. Request statistics follow the final answer; elapsed time is wall time, not the sum of tool durations. Old records without precise timing use message timestamps. Unfinished requests have no final summary. Statistics follow one blank separator without a panel background, starting directly with the call count rather than a `Tools` label and preserving native body padding.

`TPS N.N tok/s` follows elapsed time and retains the standalone `tps.ts` formula: sum assistant `usage.output` from the current `agent_end.messages` and divide by the total seconds between `agent_start` and `agent_end`. Network, waiting, thinking and tool execution time are included; reasoning tokens are not split out. TPS measures that agent run while the other counts remain request-scoped. It is stored in the existing custom entry for reload; old records do not infer TPS. Missing starts, non-positive elapsed time or no output omit TPS. Only existing aggregate summaries gain the metric; answer-only requests and notifications remain unchanged. Disable the standalone `tps.ts` after integration to avoid duplicate notifications.

Bash uses supplied native output data to exclude empty-output and exit-status notices, ignoring trailing newlines and terminal wrapping. For upstream truncation it uses output-line metadata and shows `truncated`, without reading the full-output file. Old sessions without recorded counts fall back to received text, which may include native status notices. There are no command-specific success-summary rules in aggregate mode.

Aggregate uses the prototype's subdued background and green/purple tool labels, adjusted for light/dark appearance and terminal color capability. Thinking is colored only when its continuous region contains tools; standalone thinking stays native. Panel thinking has one colored blank row above it, reusing outer top padding at the start, and connects directly to tools below. A single blank line separates their shared region from normal text; normal text remains uncolored and breaks the panel. Each region also has one colored padding row at its top and bottom. All tool names align with body text, respecting native `outputPad` (one column by default, or zero), without gutters or extra reserved marker space. Parallel groups have a subdued blue-gray `parallel · N calls` heading directly above their tools. One colored blank row separates sections when entering or leaving a parallel group, including adjacent parallel groups. Existing outer padding is reused at region boundaries. Serial tools remain tightly packed, and the background stays continuous across groups. Panel backgrounds are reapplied after embedded ANSI resets to avoid holes after truncation.

Reversible native tool `render/handleMouse` and assistant `render` patches remove intra-region per-tool spacing and append the transient summary. Installed only in TUI sessions and restored on reload/shutdown. Thinking content and expansion state remain native; background/layout wrappers forward clicks to the original MouseRegion. Only thinking rows receive the panel background in mixed thinking/text messages. Per-row tool expansion and image paths remain intact.

## Images

Pi keeps ownership of image protocols, display settings and conversion. An image can remain visible while its text result is collapsed, matching native Pi behavior. Actual pixel display depends on terminal support and Pi settings. In aggregate mode, images remain after their owning tool. A colored bottom-padding row closes the text panel before the image; if more tools follow in the same region, a colored top-padding row resumes the panel. Existing section padding is reused. Images are not relocated to the end of the tool region.

## Custom tools

`ffgrep`, `fffind` and `codemode` are adapted automatically in TUI mode, without changes to their extension or registration code. Adapters live in `src/custom-tools.ts` and replace only the UI component's definition, never the registered/executing tool, schema, exposure or activation state. Shutdown/reload restores the native renderer.

FFF rows show pattern, path and `totalMatched` counts (matches for ffgrep, files for fffind), falling back to result-line counts for old results. Expand for full output. Codemode collapses to its first code line and nested-call count, or output-line count excluding the native status header. Expansion preserves native script, nested-call statuses and output. Statistics count only top-level codemode calls; nested calls are not shown as independent parallel groups. None of these tools is enabled automatically.

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
```

Development requires Pi's host packages and `typebox` to resolve locally. Validation on this machine uses symlinks to the existing Pi installation, without installing a second Pi copy.

See [polish validation](./checks/polish-validation.md) for spacing refinements, automatic custom adapters, 42 tests and real fullscreen checks. The earlier unified-panel implementation is recorded in [thinking validation](./checks/thinking-validation.md). Earlier parallel headings are recorded in [layout validation](./checks/parallel-heading-validation.md). Earlier background and padding changes are recorded in [visual fix validation](./checks/visual-fix-validation.md). The [first aggregate validation](./checks/aggregate-validation.md) is retained. The [original validation notes](./checks/project-3-validation.md) are retained for the previous per-tool implementation. Licensed under [MIT](./LICENSE).
