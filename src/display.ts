import {
  getLanguageFromPath, highlightCode, renderDiff,
  type Theme, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Container, Text, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { bashOutputLines, transcriptPadding } from "./activity.ts";
import { getDisplayStyle, trackRow, type DisplayContext } from "./state.ts";
import {
  cleanText, firstLine, fullText, IndentedResult, lineCount, plural,
  panelLine, SummaryLine, textOutput, TidyShell, toolLabel,
} from "./render-utils.ts";

export type DisplayKind = "bash" | "read" | "search" | "edit" | "write" | "generic";
export interface DisplayAdapter {
  kind?: DisplayKind;
  target?: (args: Record<string, unknown>) => string;
  summary?: (result: Parameters<NonNullable<ToolDefinition<any>["renderResult"]>>[0]) => string;
}
const builtInKinds: Record<string, DisplayKind> = {
  bash: "bash", read: "read", grep: "search", find: "search", ls: "search", edit: "edit", write: "write",
};
const titles: Record<string, string> = { bash: "Bash", read: "Read", grep: "Grep", find: "Find", ls: "Ls", edit: "Edit", write: "Write" };
type Result = Parameters<NonNullable<ToolDefinition<any>["renderResult"]>>[0];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
function backgrounded(kind: DisplayKind, result: Result): boolean {
  const details = record(result.details);
  return kind === "bash" && details.status === "running" && typeof details.task_id === "string";
}
function path(args: Record<string, unknown>): string {
  return String(args.file_path ?? args.path ?? "");
}
function target(toolName: string, kind: DisplayKind, args: Record<string, unknown>): string {
  if (kind === "bash") return String(args.command ?? "…");
  if (kind === "read") {
    const from = typeof args.offset === "number" ? args.offset : 1;
    const suffix = typeof args.limit === "number" ? `:${from}-${from + args.limit - 1}` : args.offset !== undefined ? `:${from}` : "";
    return path(args) + suffix;
  }
  if (kind === "edit" || kind === "write") return path(args);
  if (kind === "search") {
    if (toolName === "ls") return path(args) || ".";
    return `${String(args.pattern ?? "")} in ${path(args) || "."}`;
  }
  return Object.entries(args)
    .filter(([key, value]) => !/content|prompt|password|secret|token|credential/i.test(key) && (typeof value === "string" || typeof value === "number"))
    .slice(0, 2).map(([, value]) => String(value).slice(0, 80)).join(" · ");
}
function metadata(kind: DisplayKind, args: Record<string, unknown>): string {
  if (kind === "edit") {
    const count = Array.isArray(args.edits) ? args.edits.length : args.oldText !== undefined ? 1 : 0;
    return count ? ` (${plural(count, "block")})` : "";
  }
  if (kind === "write") return ` (${plural(lineCount(String(args.content ?? "")), "line")})`;
  if (kind === "bash" && args.timeout) return ` (timeout ${args.timeout}s)`;
  return "";
}
function diffStats(result: Result): string {
  const diff = record(result.details).diff;
  if (typeof diff !== "string") return "";
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return ` +${added} -${removed}`;
}
function summary(kind: DisplayKind, result: Result, rawOutput: string): string {
  const images = result.content.filter((block) => block.type === "image").length;
  const count = lineCount(rawOutput);
  switch (kind) {
    case "read": return `loaded ${images ? plural(images, "image") : plural(count, "line")}`;
    case "edit": return `applied${diffStats(result)}`;
    case "write": return "done";
    case "search": return `${plural(rawOutput.split("\n").filter((line) => line.trim()).length, "result")} returned`;
    default: return images ? `${plural(images, "image")} returned` : count ? `${plural(count, "line")} returned` : "(no output)";
  }
}
function truncation(result: Result): { suffix: string; fullPath?: string } {
  const details = record(result.details);
  const info = record(details.truncation);
  return {
    suffix: info.truncated ? " • truncated" : "",
    fullPath: typeof details.fullOutputPath === "string" ? details.fullOutputPath : typeof info.fullOutputPath === "string" ? info.fullOutputPath : undefined,
  };
}
function shell(context: DisplayContext, theme: Theme): TidyShell {
  const state = context.state as { compactToolShell?: TidyShell };
  const component = state.compactToolShell ??= new TidyShell();
  component.update(theme, context.isPartial, context.isError);
  return component;
}
function callComponent(tool: { name: string }, adapter: DisplayAdapter, kind: DisplayKind, args: Record<string, unknown>, theme: Theme, context: DisplayContext): Component {
  const tidy = getDisplayStyle() === "tidy";
  const displayTarget = cleanText(adapter.target ? adapter.target(args) : target(tool.name, kind, args));
  const meta = theme.fg("muted", metadata(kind, args));
  const color = context.isError ? "error" : context.isPartial ? "warning" : "success";
  const title = tidy
    ? kind === "bash" ? theme.fg("toolTitle", theme.bold(`$ ${displayTarget}`)) + meta
      : theme.fg("toolTitle", theme.bold(`${tool.name} `)) + theme.fg("accent", displayTarget) + meta
    : theme.fg(color, context.isError ? "✗ " : "● ") + theme.bold(`${titles[tool.name] ?? tool.name}(`) + theme.fg("text", displayTarget) + theme.bold(")") + meta;
  const header: Component = context.expanded && kind === "bash" ? new Text(title, 0, 0) : new SummaryLine(title);
  if (!context.expanded || kind !== "write") return header;
  const container = new Container();
  container.addChild(header);
  const content = cleanText(String(args.content ?? ""));
  const language = getLanguageFromPath(path(args));
  const body = language ? new Text(highlightCode(content, language).join("\n"), 0, 0) : fullText(content, theme);
  container.addChild(tidy ? body : new IndentedResult(body));
  return container;
}
function resultComponent(adapter: DisplayAdapter, kind: DisplayKind, result: Result, expanded: boolean, partial: boolean, theme: Theme, context: DisplayContext): Component {
  const rawOutput = textOutput(result);
  const error = context.isError || (result as Result & { isError?: boolean }).isError === true;
  const hint = truncation(result);
  if (expanded && !partial) {
    const diff = record(result.details).diff;
    let body: Component;
    if (kind === "edit" && !error && typeof diff === "string") {
      body = new Text(renderDiff(diff, { filePath: path(record(context.args)) }), 0, 0);
    } else {
      body = fullText(kind === "write" && !error ? "done" : rawOutput || summary(kind, result, rawOutput), theme, error);
    }
    if (!hint.suffix && !hint.fullPath) return body;
    const container = new Container();
    container.addChild(body);
    container.addChild(new Text(theme.fg("warning", [hint.suffix.trim(), hint.fullPath ? `Full output: ${cleanText(hint.fullPath)}` : ""].filter(Boolean).join("\n")), 0, 0));
    return container;
  }
  if (error) return new SummaryLine(theme.fg("error", `failed: ${firstLine(rawOutput) || "Tool failed"}`) + theme.fg("warning", hint.suffix));
  if (partial) {
    return new SummaryLine(theme.fg("warning", firstLine(rawOutput) || "running…"));
  }
  if (backgrounded(kind, result)) return new SummaryLine(theme.fg("warning", "Backgrounded"));
  if (kind === "bash" && getDisplayStyle() === "tidy") {
    const more = Math.max(0, lineCount(rawOutput) - 1);
    const suffix = [more ? `… (${plural(more, "more line")})` : "", hint.suffix].filter(Boolean).join("");
    return new SummaryLine(theme.fg("toolOutput", firstLine(rawOutput) || "(no output)"), theme.fg("muted", suffix));
  }
  const text = adapter.summary ? cleanText(adapter.summary(result)) : summary(kind, result, rawOutput);
  return new SummaryLine(theme.fg(kind === "edit" || kind === "write" ? "success" : "muted", text) + theme.fg("warning", hint.suffix));
}

class AggregateShell implements Component {
  private name = "";
  private target = "";
  private context!: DisplayContext;
  private theme!: Theme;
  private summary = "";
  private body?: Component;
  private cached?: { width: number; padding: number; bashLines?: number; rows: string[] };
  call(name: string, displayTarget: string, theme: Theme, context: DisplayContext): void {
    this.name = name; this.target = displayTarget; this.theme = theme; this.context = context;
    this.summary = ""; this.body = undefined; this.cached = undefined;
  }
  result(text: string, body?: Component): void { this.summary = text; this.body = body; this.cached = undefined; }
  render(width: number): string[] {
    if (width < 1) return [];
    const padding = transcriptPadding();
    const bashLines = this.name === "bash" && !this.context.isPartial ? bashOutputLines(this.context.toolCallId) : undefined;
    if (this.cached?.width === width && this.cached.padding === padding && this.cached.bashLines === bashLines) return this.cached.rows;
    const theme = this.theme;
    const error = this.context.isError;
    const label = (error ? theme.fg("error", this.name.padEnd(5)) : toolLabel(this.name, this.name.padEnd(5), theme)) + " ";
    const target = theme.fg(error ? "error" : "text", this.target);
    const summary = bashLines === undefined ? this.summary : this.summary.replace(/^\d+ lines?/, plural(bashLines, "line"));
    const suffix = summary ? theme.fg("muted", summary) : "";
    const header = new SummaryLine(label + target, suffix).render(Math.max(1, width - padding * 2))[0] ?? "";
    const rows = [truncateToWidth(" ".repeat(padding) + header, width, "…")];
    if (this.body) rows.push(...this.body.render(Math.max(1, width - 3)).map(row => truncateToWidth("   " + row, width, "…")));
    const painted = rows.map(row => panelLine(row, width, theme, this.context.isPartial));
    this.cached = { width, padding, bashLines, rows: painted };
    return painted;
  }
  invalidate(): void { this.cached = undefined; this.body?.invalidate(); }
}
function aggregateShell(context: DisplayContext): AggregateShell {
  const state = context.state as { compactAggregate?: AggregateShell };
  return state.compactAggregate ??= new AggregateShell();
}
function aggregateSummary(adapter: DisplayAdapter, kind: DisplayKind, result: Result, context: DisplayContext, partial: boolean): string {
  const output = textOutput(result);
  const hint = truncation(result);
  const suffix = hint.suffix ? " · truncated" : "";
  if (!partial && backgrounded(kind, result)) return "Backgrounded";
  if (kind === "bash") return `${plural(output === "(no output)" ? 0 : lineCount(output), "line")}${partial ? " · running" : ""}${suffix}`;
  if (context.isError) return "";
  if (partial) return "running…";
  if (adapter.summary) return cleanText(adapter.summary(result)) + suffix;
  if (kind === "read") {
    const images = result.content.filter(block => block.type === "image").length;
    return (images ? plural(images, "image") : plural(lineCount(output), "line")) + suffix;
  }
  if (kind === "edit") return diffStats(result).trim();
  if (kind === "write") return plural(lineCount(String(record(context.args).content ?? "")), "line");
  if (kind === "search") return plural(output.split("\n").filter(line => line.trim()).length, "result") + suffix;
  return plural(lineCount(output), "line") + suffix;
}

/** Opt in to display replacement. Execution, schemas and model-facing metadata keep their original references. */
export function decorateTool<TParams extends TSchema, TDetails, TState>(
  tool: ToolDefinition<TParams, TDetails, TState>, adapter: DisplayAdapter = {},
): ToolDefinition<TParams, TDetails, TState> {
  const kind = adapter.kind ?? builtInKinds[tool.name] ?? "generic";
  return {
    ...tool,
    renderShell: "self",
    renderCall(args, theme, context) {
      trackRow(context);
      if (getDisplayStyle() === "aggregate") {
        const box = aggregateShell(context);
        const displayTarget = adapter.target ? adapter.target(record(args)) : target(tool.name, kind, record(args));
        box.call(tool.name, cleanText(displayTarget).replace(/\n/g, " ↵ "), theme, context);
        if (!context.executionStarted) box.result("pending…");
        else if (context.isPartial) box.result("running…");
        return box;
      }
      const component = callComponent(tool, adapter, kind, record(args), theme, context);
      if (getDisplayStyle() !== "tidy") return component;
      const box = shell(context, theme);
      box.setCall(component);
      return box;
    },
    renderResult(result, options, theme, context) {
      trackRow(context);
      if (getDisplayStyle() === "aggregate") {
        const box = aggregateShell(context);
        let body: Component | undefined;
        if (options.expanded) {
          if (kind === "write" && !context.isError) {
            const content = cleanText(String(record(context.args).content ?? ""));
            const language = getLanguageFromPath(path(record(context.args)));
            body = language ? new Text(highlightCode(content, language).join("\n"), 0, 0) : fullText(content, theme);
          } else {
            body = options.isPartial ? fullText(textOutput(result), theme, context.isError) : resultComponent(adapter, kind, result, true, false, theme, context);
          }
        }
        box.result(aggregateSummary(adapter, kind, result, context, options.isPartial), body);
        return new Container();
      }
      const component = resultComponent(adapter, kind, result, options.expanded, options.isPartial, theme, context);
      if (getDisplayStyle() !== "tidy") return new IndentedResult(component);
      const box = shell(context, theme);
      box.setResult(component);
      return new Container();
    },
  };
}
