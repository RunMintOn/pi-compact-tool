# Apply Patch native body and scrolling regression

Scope: preserve one complete native expanded body, avoid repainting it on every aggregate frame, and verify interaction with the sibling `pi-codex-apply-patch-helper-prototype` project. Pi 1.4.0, Node v22.23.2. Reviewed directly without sub-agents.

## Cause and change

The previous apply_patch adapter called the compact result renderer before returning a separate native panel. That first call stored generic expanded output in the tidy/aggregate shell, so errors and recovery details appeared twice. The separate nativePanel also re-truncated and repainted every native row on every frame.

The adapter now passes the native result renderer as `DisplayAdapter.renderExpanded`. Its body is owned by the existing shell, including AggregateShell's existing layout cache and invalidation. There is no separate apply_patch panel, extra cache implementation, execution override or tool-registry change. Other tools retain their existing behavior.

## Executed checks

- Expanded-error regression: **failed before** with `2 !== 1`, **passed after**, across tidy/aggregate/claude and repeated expansion cycles.
- Complete 4000-row native-details regression: **passed**, including warm-frame budget, invalidation, resize and updated results.
- `npm run check`: **passed**, including strict typecheck and **84 tests**.
- Sibling `npm test`: **51 passed**; sibling strict typecheck and real-Agent partial-failure recovery: **passed**.
- Combined real fullscreen replay: **passed**. Actual helper results cover partial failure and a 2000-line pure move; Ctrl+O, aggregate/tidy/claude/off switches and narrow resize preserve exactly one error/recovery body and one move summary.
- Same ScrollView/fullscreen-layout probe as before the fix: **passed** with all original symptom assertions. The stable 40-row viewport scrolls three lines per sample.
- Both worktrees' `git diff --check`: **passed**.

## Performance

Same 2000-line replacement, five-sample median for scrolling layout:

| Width | Before | After |
| --- | ---: | ---: |
| 80 | 128.7ms | 0.053ms |
| 140 | 220.1ms | 0.078ms |

The sibling renderer also replaces per-row HStack compositing with padded native Text columns. Its initial standalone wide layout decreased from 604.3ms to 94.0ms in the focused probe; combined initial layout decreased from 735.9ms to 211.6ms.

These are local CPU measurements, not physical terminal-paint or human-perceived latency guarantees. Full contents remain available; no truncation, virtualization or background service was introduced.

## Inspectable artifacts

`/tmp/pi-patch-diagnosis-kWKOtH/` contains:

- `before-report.json`, `report.json`, `before-run.log`, `after-run.log`.
- `compact-red.log`, `compact-check.log`, `patch-tests.log`, `patch-types.log`, `live.log`.
- `fullscreen.ansi.log`, reconstructed screen text, `tui-check.log`.
- Re-runnable `run.mjs`/`probe.ts` and `tui-seed.mjs`/`tui.exp`/`tui-screen.py`.

The original user session was not reloaded. Tests use separate disposable workspaces and do not modify user settings or existing files. The full details and conservative simple-move rules are documented in the sibling project's VERIFICATION.md.
