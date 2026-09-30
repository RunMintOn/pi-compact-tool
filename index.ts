import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ACTIVITY_ENTRY, ActivityProjection, installActivityUI } from "./src/activity.ts";
import { createDisplayTools } from "./src/tools.ts";
import { getDisplayStyle, refreshDisplayRows, resetDisplayState, setDisplayStyle, type DisplayStyle } from "./src/state.ts";

const styles: DisplayStyle[] = ["aggregate", "tidy", "claude"];
const labels: Record<DisplayStyle, string> = { aggregate: "聚合风格（aggregate）", tidy: "项目一风格（tidy）", claude: "项目三风格（claude）" };
export default function compactToolExtension(pi: ExtensionAPI): void {
  for (const tool of createDisplayTools(() => pi.getSettings())) pi.registerTool(tool);
  const activity = new ActivityProjection();
  let releaseUI: (() => void) | undefined;
  let persistedFinal: string | undefined;
  const interactive = (ctx: ExtensionContext) => ctx.hasUI && ctx.mode === "tui";
  const rebuild = (ctx: ExtensionContext) => {
    if (!interactive(ctx)) return;
    activity.rebuild(ctx.sessionManager.buildContextEntries());
    refreshDisplayRows();
  };

  pi.registerFlag("compact-style", {
    description: "Initial tool display style: aggregate, tidy or claude",
    type: "string",
    default: "aggregate",
  });
  pi.registerCommand("tool-style", {
    description: "Switch aggregate, tidy and Claude-style tool display",
    getArgumentCompletions(prefix) {
      return styles.filter(style => style.startsWith(prefix)).map(style => ({ value: style, label: style }));
    },
    async handler(args, ctx) {
      if (!interactive(ctx)) return;
      const value = args.trim();
      if (value && !styles.includes(value as DisplayStyle)) {
        ctx.ui.notify("使用 /tool-style aggregate、/tool-style tidy 或 /tool-style claude", "error");
        return;
      }
      const style = value as DisplayStyle || styles[(styles.indexOf(getDisplayStyle()) + 1) % styles.length]!;
      setDisplayStyle(style);
      ctx.ui.notify(`工具展示：${labels[style]}`, "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    releaseUI?.(); releaseUI = undefined; persistedFinal = undefined;
    const flag = pi.getFlag("compact-style");
    resetDisplayState(styles.includes(flag as DisplayStyle) ? flag as DisplayStyle : "aggregate");
    if (!interactive(ctx)) return;
    rebuild(ctx);
    // Render callbacks can outlive this session's extension context.
    const theme = ctx.ui.theme;
    const outputPad = pi.getSettings().outputPad === 0 ? 0 : 1;
    releaseUI = installActivityUI(activity, () => theme, () => outputPad);
    if (!styles.includes(flag as DisplayStyle)) ctx.ui.notify("compact-style 只支持 aggregate、tidy 或 claude，已使用 aggregate。", "warning");
  });
  pi.on("message_end", (event, ctx) => {
    if (!interactive(ctx)) return;
    activity.ingest(event.message);
    if (event.message.role === "assistant") activity.completed(event.message, Date.now());
  });
  pi.on("tool_execution_start", (event, ctx) => {
    if (!interactive(ctx) || event.parentToolCallId) return;
    activity.started(event.toolCallId, Date.now());
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (!interactive(ctx) || event.parentToolCallId) return;
    activity.ended(event.toolCallId, Date.now(), event.toolName === "bash" ? event.result : undefined);
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (!interactive(ctx)) return;
    const timing = activity.timingRecord();
    if (timing.finalKey && timing.finalKey !== persistedFinal && timing.calls.length) {
      // Non-context custom data makes observed parallel/serial dispatch and wall time
      // survive reload without adding model-visible messages or altering tool results.
      pi.appendEntry(ACTIVITY_ENTRY, timing);
      persistedFinal = timing.finalKey;
    }
  });
  pi.on("session_tree", (_event, ctx) => rebuild(ctx));
  pi.on("session_compact", (_event, ctx) => rebuild(ctx));
  pi.on("session_shutdown", () => {
    releaseUI?.(); releaseUI = undefined;
    resetDisplayState();
  });
}
