# Changelog

## 0.1.0

First public release.

- Three switchable display styles for Pi's TUI: `aggregate` (default), `tidy`, `claude`, plus an `off` mode that restores native rendering.
- Single `/tools` menu for style, Bash and codemode colors, codemode detail level and finished-thinking visibility.
- Task statistics after the final answer: tool counts, wall time, tool time, TPS, cost and cache hit rate.
- Parallel tool groups with headings, tool-region thinking, and per-row click-to-expand in fullscreen.
- `/changes` net-diff HTML report with file navigation, unified/split layouts, word diffs and collapsed unchanged runs. Reports and their statistics links survive `/resume`, session switching, `/reload` and context compaction, following the current conversation branch; a missing or unreadable report is reported as such instead of falling back to an older one.
- Display adapters for `ffgrep`, `fffind`, `codemode` and `apply_patch`, plus `decorateTool()` for other tools through `@runminton/pi-compact-tool/display`.
- Agent-facing adapter skill `pi-compact-tool-adapter`.
- Execution continues to delegate to Pi's official tool implementations; schemas, model-facing metadata and activation state are unchanged.

Validation notes and the current test count live in [`checks/`](https://github.com/RunMintOn/pi-compact-tool/tree/main/checks).
