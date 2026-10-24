# Compact statistics and cache hit rate

## Sources

Checked the locally installed Pi 1.2.0 source and queried current Pi documentation through Context7 (`/earendil-works/pi`).
The canonical `Usage` interface lists the fields but does not describe the input partition fully; provider normalization and the native footer supply the accounting semantics.

Local source root:
`/Users/ziqian/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/`

- `pi-ai/dist/types.d.ts:274`: canonical Usage interface. `cacheWrite1h` is a subset of `cacheWrite`, not an additional input category.
- `pi-ai/dist/api/openai-responses-shared.js:440`: OpenAI prompt input includes cached tokens; Pi subtracts both cache reads and writes to produce `usage.input`.
- `pi-ai/dist/api/openai-codex-responses.js:480,1206`: Codex SSE and WebSocket paths use the shared Responses normalization.
- `pi-ai/dist/api/openai-completions.js:1163`: uncached input is prompt tokens minus reads and writes. OpenAI, DeepSeek and Kimi cache-read field variants map to `cacheRead`.
- `pi-ai/dist/api/anthropic-messages.js:494`: input, cache reads and cache creation are separate categories; total tokens sum these plus output.
- `pi-ai/dist/api/google-generative-ai.js:171`: Pi subtracts cached content from prompt input.
- `pi-coding-agent/dist/modes/interactive/components/footer.js:105`: native cache hit rate is `cacheRead / (input + cacheRead + cacheWrite) × 100`, evaluated for the latest assistant message.

Upstream references:

- https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts
- https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-responses-shared.ts
- https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-completions.ts
- https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/anthropic-messages.ts
- https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/google-generative-ai.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/footer.ts

## Semantics and scope

Use Pi's normalized fields without reinterpreting raw provider responses:

```text
task cache hit rate = Σ cacheRead / Σ(input + cacheRead + cacheWrite)
```

The task summary's existing scope is assistant usage throughout one continuous task, including steering/follow-up/continuations. It excludes separate tool-reported usage, compaction generation and earlier tasks; this change does not expand that scope. The native footer uses the latest assistant request for its percentage.

Reads are hits. Writes belong in the denominator only. Output is excluded. Missing usage or zero input omits the percentage; positive input with no reported reads shows 0%. Pi initializes unreported cache counts to zero, so this is a rate based on recorded usage, not a claim about provider cache support.

## Display changes

- `TPS 26.0 tok/s` → `26.0 tok/s`; calculation unchanged.
- Separate `cache read` / `cache write` quantities → `cache 85%`.
- Local date/time → `MM-DD HH:mm:ss`.
- No tool calls → one content row; no calls/turns heading.
- Tool calls → existing two-row layout. `total` remains on the statistics row.
- Existing change links remain visible for answer-only summaries.

## Verification

New tests ran before implementation and failed on all three tested behavior groups:

```sh
node --import tsx --test --test-name-pattern='cache hit rate|cache rate distinguishes|answer-only statistics' tests/aggregate.test.ts
```

Log: `/tmp/compact-summary-red.log`.

After implementation:

```sh
npm run check
npm run test:display-tui -- /Users/ziqian/20-dev/20-ecosystems/01-pi/extensions/pi-raw-mode/extensions/index.ts
git diff --check
```

- Typecheck passed; 80 tests passed.
- Weighted rate: requests with 800/1000 and 0/100 hits produce 72.7%, not 40%. Cache writes are included in total input; large output does not change the rate.
- Zero hits, all hits, write-only input and unavailable input are covered.
- Persisted timing/summary replay preserves the result.
- Answer-only row count, speed label, date precision, native padding, change links and narrow widths are checked.
- Real Pi fullscreen replay includes both a tool task and an answer-only task. The screen assertions check 72.7%, 0%, unlabelled speed, compact date and no answer-only heading at every stage, including three reloads with the actual raw-mode extension.
- Replay makes no model requests; provider normalization was inspected, not tested against live APIs.

Logs: `/tmp/compact-summary-check.log`, `/tmp/compact-summary-tui.log`.
Terminal artifacts: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-display-results-x9pwKb/`.
