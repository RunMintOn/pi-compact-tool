import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ChangeTracker, type ChangeOutcome } from "./src/changes.ts";
import { ACTIVITY_ENTRY, ActivityProjection, installActivityUI } from "./src/activity.ts";
import { createDisplayTools } from "./src/tools.ts";
import { getDisplayStyle, refreshDisplayRows, resetDisplayState, setDisplayPreferences, setDisplayStyle, type DisplayPreferences, type DisplayStyle } from "./src/state.ts";
import { loadPreferences, savePreferences } from "./src/preferences.ts";
import { displayStyles as styles, openDisplayMenu } from "./src/menu.ts";

// Reload replaces extension modules but keeps the Pi process and its globals.
const selectionKey = Symbol.for("pi-compact-tool.style-selection.v1");
const selection = (globalThis as typeof globalThis & { [selectionKey]?: { style?: DisplayStyle } })[selectionKey] ??= {};
export default function compactToolExtension(pi: ExtensionAPI): void {
  const changes = new ChangeTracker();
  for (const tool of createDisplayTools(() => pi.getSettings(), changes, false)) {
    // Bash display is adapted at the TUI layer; leave execution to Pi or another extension.
    if (tool.name !== "bash") pi.registerTool(tool);
  }
  const activity = new ActivityProjection();
  let outcome: ChangeOutcome = "completed";
  let releaseUI: (() => void) | undefined;
  let persistedFinal: string | undefined;
  const interactive = (ctx: ExtensionContext) => ctx.hasUI && ctx.mode === "tui";
  const enabled = (ctx: ExtensionContext) => interactive(ctx) && getDisplayStyle() !== "off";
  const installUI = (ctx: ExtensionContext) => {
    const theme = ctx.ui.theme;
    const outputPad = pi.getSettings().outputPad === 0 ? 0 : 1;
    releaseUI = installActivityUI(activity, () => theme, () => outputPad);
  };
  const preferencesPath = join(getAgentDir(), "extension-data", "pi-compact-tool", "preferences.json");
  const loadSavedPreferences = async (ctx: ExtensionContext) => {
    try {
      setDisplayPreferences(await loadPreferences(preferencesPath));
    } catch (error) {
      ctx.ui.notify(`无法读取展示偏好，使用默认值：${error instanceof Error ? error.message : String(error)}`, "warning");
    }
  };
  const updatePreferences = async (patch: Partial<DisplayPreferences>, ctx: ExtensionContext) => {
    try {
      setDisplayPreferences(await savePreferences(preferencesPath, patch));
    } catch (error) {
      ctx.ui.notify(`无法保存展示偏好：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };
  const rebuild = (ctx: ExtensionContext) => {
    if (!enabled(ctx)) return;
    activity.rebuild(ctx.sessionManager.buildContextEntries());
    refreshDisplayRows();
  };

  pi.registerFlag("compact-style", {
    description: "Initial tool display style: aggregate, tidy, claude or off",
    type: "string",
    default: "aggregate",
  });
  pi.registerCommand("tools", {
    description: "工具展示设置：风格、颜色、Codemode 和思考显示",
    async handler(_args, ctx) {
      if (!interactive(ctx)) return;
      if (getDisplayStyle() === "off") await loadSavedPreferences(ctx);
      await openDisplayMenu(ctx, async style => {
        if (style === "off") {
          releaseUI?.(); releaseUI = undefined;
          changes.reset(); activity.clearChanges(); activity.rebuild([]);
          persistedFinal = undefined; outcome = "completed";
        }
        const wasOff = getDisplayStyle() === "off";
        selection.style = style;
        setDisplayStyle(style);
        if (wasOff && style !== "off") {
          await loadSavedPreferences(ctx);
          rebuild(ctx);
          installUI(ctx);
        }
      }, patch => updatePreferences(patch, ctx));
    },
  });

  pi.registerCommand("changes", {
    description: "Open the latest Edit / Write / apply_patch net changes in your browser",
    async handler(_args, ctx) {
      if (!interactive(ctx)) return;
      if (!enabled(ctx)) {
        ctx.ui.notify("off 模式不记录修改报告。使用 /tools 切换展示风格以重新启用。", "info");
        return;
      }
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
    resetDisplayState(selection.style ?? (styles.includes(flag as DisplayStyle) ? flag as DisplayStyle : "aggregate"));
    if (!enabled(ctx)) return;
    await loadSavedPreferences(ctx);
    rebuild(ctx);
    installUI(ctx);
    if (!styles.includes(flag as DisplayStyle)) ctx.ui.notify("compact-style 只支持 aggregate、tidy、claude 或 off，已使用 aggregate。", "warning");
  });
  pi.on("agent_start", (_event, ctx) => {
    if (!enabled(ctx)) return;
    changes.start(ctx.cwd, Date.now());
    activity.agentStarted(Date.now());
  });
  pi.on("agent_before_settle", (event, ctx) => {
    if (enabled(ctx)) outcome = event.outcome;
  });
  pi.on("agent_end", (event, ctx) => {
    if (!enabled(ctx)) return;
    activity.agentEnded(event.messages, Date.now());
  });
  pi.on("message_update", (event, ctx) => {
    if (enabled(ctx)) activity.streamUpdated(event.message, event.assistantMessageEvent);
  });
  pi.on("message_end", (event, ctx) => {
    if (!enabled(ctx)) return;
    activity.ingest(event.message);
    if (event.message.role === "user") {
      changes.start(ctx.cwd, event.message.timestamp ?? Date.now());
      changes.userMessage(event.message);
    }
    if (event.message.role === "assistant") activity.completed(event.message, Date.now());
  });
  pi.on("tool_execution_start", async (event, ctx) => {
    if (!enabled(ctx)) return;
    if (!event.parentToolCallId) activity.started(event.toolCallId, Date.now());
    if (event.toolName === "apply_patch" && typeof event.args.patch === "string") {
      await changes.capturePatchBefore(event.args.patch, ctx.cwd);
    }
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (!enabled(ctx)) return;
    if (event.toolName === "apply_patch" && event.isError) changes.patchFailed();
    if (!event.parentToolCallId) activity.ended(event.toolCallId, Date.now(), event.toolName === "bash" ? event.result : undefined);
  });
  pi.on("agent_settled", async (_event, ctx) => {
    if (!enabled(ctx)) return;
    activity.settled(Date.now());
    refreshDisplayRows();
    const timing = activity.timingRecord();
    try {
      const report = await changes.finish(Date.now(), outcome);
      if (report) {
        if (report.files.length || report.incomplete) {
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
    if (timing.finalKey && timing.finalKey !== persistedFinal) {
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
