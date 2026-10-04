import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ChangeTracker, type ChangeOutcome } from "./src/changes.ts";
import { ACTIVITY_ENTRY, ActivityProjection, installActivityUI } from "./src/activity.ts";
import { createDisplayTools } from "./src/tools.ts";
import { getDisplayPreferences, getDisplayStyle, refreshDisplayRows, resetDisplayState, setDisplayPreferences, setDisplayStyle, type DisplayPreferences, type DisplayStyle } from "./src/state.ts";
import { loadPreferences, savePreferences } from "./src/preferences.ts";

const styles: DisplayStyle[] = ["aggregate", "tidy", "claude"];
const labels: Record<DisplayStyle, string> = { aggregate: "聚合风格（aggregate）", tidy: "项目一风格（tidy）", claude: "项目三风格（claude）" };
export default function compactToolExtension(pi: ExtensionAPI): void {
  const changes = new ChangeTracker();
  for (const tool of createDisplayTools(() => pi.getSettings(), changes)) pi.registerTool(tool);
  const activity = new ActivityProjection();
  let outcome: ChangeOutcome = "completed";
  let releaseUI: (() => void) | undefined;
  let persistedFinal: string | undefined;
  const interactive = (ctx: ExtensionContext) => ctx.hasUI && ctx.mode === "tui";
  const preferencesPath = join(getAgentDir(), "extension-data", "pi-compact-tool", "preferences.json");
  const updatePreferences = async (patch: Partial<DisplayPreferences>, label: string, ctx: ExtensionContext) => {
    try {
      setDisplayPreferences(await savePreferences(preferencesPath, patch));
      ctx.ui.notify(`${label}（已保存全局偏好，仅 aggregate 生效）`, "info");
    } catch (error) {
      ctx.ui.notify(`无法保存展示偏好：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };
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

  pi.registerCommand("codemode-view", {
    description: "Switch aggregate codemode preview: compact or native calls",
    getArgumentCompletions(prefix) {
      return ["compact", "calls"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value }));
    },
    async handler(args, ctx) {
      if (!interactive(ctx)) return;
      const value = args.trim() || (getDisplayPreferences().codemodeView === "compact" ? "calls" : "compact");
      if (value !== "compact" && value !== "calls") {
        ctx.ui.notify("使用 /codemode-view compact 或 /codemode-view calls", "error");
        return;
      }
      await updatePreferences({ codemodeView: value }, `codemode 展示：${value}`, ctx);
    },
  });

  pi.registerCommand("tool-thinking", {
    description: "Show or hide all thinking in aggregate display",
    getArgumentCompletions(prefix) {
      return ["show", "hide"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value }));
    },
    async handler(args, ctx) {
      if (!interactive(ctx)) return;
      const value = args.trim() || (getDisplayPreferences().showThinking ? "hide" : "show");
      if (value !== "show" && value !== "hide") {
        ctx.ui.notify("使用 /tool-thinking show 或 /tool-thinking hide", "error");
        return;
      }
      await updatePreferences({ showThinking: value === "show" }, `thinking 展示：${value}`, ctx);
    },
  });

  pi.registerCommand("changes", {
    description: "Open the latest Edit / Write net changes in your browser",
    async handler(_args, ctx) {
      if (!interactive(ctx)) return;
      await ctx.waitForIdle();
      const path = changes.latestPage;
      if (!path) {
        ctx.ui.notify("No change report in this session yet.", "info");
        return;
      }
      try {
        const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
        const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", pathToFileURL(path).href] : [path];
        const result = await pi.exec(command, args, { timeout: 10000 });
        if (result.code !== 0) throw new Error(result.stderr || `Exit code ${result.code}`);
      } catch {
        ctx.ui.notify(`Open change report: ${pathToFileURL(path).href}`, "warning");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    releaseUI?.(); releaseUI = undefined; persistedFinal = undefined;
    changes.reset(); activity.clearChanges(); outcome = "completed";
    const flag = pi.getFlag("compact-style");
    resetDisplayState(styles.includes(flag as DisplayStyle) ? flag as DisplayStyle : "aggregate");
    if (!interactive(ctx)) return;
    try {
      setDisplayPreferences(await loadPreferences(preferencesPath));
    } catch (error) {
      ctx.ui.notify(`无法读取展示偏好，使用默认值：${error instanceof Error ? error.message : String(error)}`, "warning");
    }
    rebuild(ctx);
    // Render callbacks can outlive this session's extension context.
    const theme = ctx.ui.theme;
    const outputPad = pi.getSettings().outputPad === 0 ? 0 : 1;
    releaseUI = installActivityUI(activity, () => theme, () => outputPad);
    if (!styles.includes(flag as DisplayStyle)) ctx.ui.notify("compact-style 只支持 aggregate、tidy 或 claude，已使用 aggregate。", "warning");
  });
  pi.on("agent_start", (_event, ctx) => {
    if (!interactive(ctx)) return;
    changes.start(ctx.cwd, Date.now());
    activity.agentStarted(Date.now());
  });
  pi.on("agent_before_settle", (event, ctx) => {
    if (interactive(ctx)) outcome = event.outcome;
  });
  pi.on("agent_end", (event, ctx) => {
    if (!interactive(ctx)) return;
    activity.agentEnded(event.messages, Date.now());
  });
  pi.on("message_end", (event, ctx) => {
    if (!interactive(ctx)) return;
    activity.ingest(event.message);
    if (event.message.role === "user") {
      changes.start(ctx.cwd, event.message.timestamp ?? Date.now());
      changes.userMessage(event.message);
    }
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
  pi.on("agent_settled", async (_event, ctx) => {
    if (!interactive(ctx)) return;
    const timing = activity.timingRecord();
    try {
      const report = await changes.finish(Date.now(), outcome);
      if (report) {
        if (report.files.length) {
          const path = await changes.save(report, join(getAgentDir(), "extension-data", "pi-compact-tool", "changes"));
          if (timing.finalKey) activity.setChanges(timing.finalKey, { label: "View changes", url: pathToFileURL(path).href });
        } else if (timing.finalKey) activity.setChanges(timing.finalKey, { label: "No net changes" });
        refreshDisplayRows();
      }
    } catch (error) {
      if (timing.finalKey) activity.setChanges(timing.finalKey, { label: "Changes unavailable" });
      ctx.ui.notify(`Could not save change report: ${error instanceof Error ? error.message : String(error)}`, "warning");
    }
    outcome = "completed";
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
    changes.reset(); activity.clearChanges();
    resetDisplayState();
  });
}
