import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ChangeTracker, type ChangeOutcome } from "./src/changes.ts";
import { ACTIVITY_ENTRY, ActivityProjection, installActivityUI } from "./src/activity.ts";
import { createDisplayTools } from "./src/tools.ts";
import { getDisplayPreferences, getDisplayStyle, getToolColor, refreshDisplayRows, resetDisplayState, setDisplayPreferences, setDisplayStyle, defaultPreferences, toolColorNames, type ToolColor, type DisplayPreferences, type DisplayStyle } from "./src/state.ts";
import { loadPreferences, savePreferences } from "./src/preferences.ts";

const styles: DisplayStyle[] = ["aggregate", "tidy", "claude", "off"];
const labels: Record<DisplayStyle, string> = { aggregate: "聚合风格（aggregate）", tidy: "项目一风格（tidy）", claude: "项目三风格（claude）", off: "原生展示（off）" };
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
  const updatePreferences = async (patch: Partial<DisplayPreferences>, label: string, ctx: ExtensionContext) => {
    try {
      setDisplayPreferences(await savePreferences(preferencesPath, patch));
      ctx.ui.notify(`${label}（已保存全局偏好，仅 aggregate 生效）`, "info");
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
  pi.registerCommand("tool-style", {
    description: "Switch aggregate, tidy, Claude-style or native (off) tool display",
    getArgumentCompletions(prefix) {
      return styles.filter(style => style.startsWith(prefix)).map(style => ({ value: style, label: style }));
    },
    async handler(args, ctx) {
      if (!interactive(ctx)) return;
      const value = args.trim();
      if (value && !styles.includes(value as DisplayStyle)) {
        ctx.ui.notify("使用 /tool-style aggregate、tidy、claude 或 off", "error");
        return;
      }
      const style = value as DisplayStyle || styles[(styles.indexOf(getDisplayStyle()) + 1) % styles.length]!;
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
      ctx.ui.notify(`工具展示：${labels[style]}`, "info");
    },
  });

  pi.registerCommand("tool-color", {
    description: "Set global aggregate bash/codemode label colors; omit color to cycle",
    getArgumentCompletions(prefix) {
      const choices = ["bash", "codemode"].flatMap(tool => [tool, ...[...toolColorNames, "reset"].map(color => `${tool} ${color}`)]);
      return choices.filter(value => value.startsWith(prefix)).map(value => ({ value, label: value }));
    },
    async handler(args, ctx) {
      if (!interactive(ctx)) return;
      const values = args.trim().split(/\s+/);
      const [tool, requested] = values;
      const usage = `使用 /tool-color bash|codemode [${toolColorNames.join("|")}|reset]；省略颜色依次切换，自动保存全局偏好，仅 aggregate 生效。`;
      if (!args.trim()) {
        ctx.ui.notify(`工具名颜色：codemode=${getToolColor("codemode")}，bash=${getToolColor("bash")}。${usage}`, "info");
        return;
      }
      if ((tool !== "bash" && tool !== "codemode") || values.length > 2 || (requested && requested !== "reset" && !toolColorNames.includes(requested as ToolColor))) {
        ctx.ui.notify(usage, "error");
        return;
      }
      const color = (requested as ToolColor | "reset" | undefined) ?? toolColorNames[(toolColorNames.indexOf(getToolColor(tool)) + 1) % toolColorNames.length]!;
      const selected = color === "reset" ? defaultPreferences[`${tool}Color`] : color;
      await updatePreferences({ [`${tool}Color`]: selected }, `${tool} 工具名颜色：${selected}`, ctx);
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
    description: "Show all thinking or hide finished thinking in aggregate display",
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
      if (!enabled(ctx)) {
        ctx.ui.notify("off 模式不记录修改报告。使用 /tool-style aggregate 重新启用。", "info");
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
  pi.on("tool_execution_start", (event, ctx) => {
    if (!enabled(ctx) || event.parentToolCallId) return;
    activity.started(event.toolCallId, Date.now());
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (!enabled(ctx) || event.parentToolCallId) return;
    activity.ended(event.toolCallId, Date.now(), event.toolName === "bash" ? event.result : undefined);
  });
  pi.on("agent_settled", async (_event, ctx) => {
    if (!enabled(ctx)) return;
    activity.settled(Date.now());
    refreshDisplayRows();
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
