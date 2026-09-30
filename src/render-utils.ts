import { backgroundAnsi, Box, parseColor, stripTerminalSequences, Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export function cleanText(text: string): string {
  return stripTerminalSequences(text).replace(/\r/g, "").replace(/\t/g, "   ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

export function textOutput(result: { content: Array<{ type: string; text?: string }> }): string {
  return cleanText(result.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n"));
}

export function lineCount(text: string): number {
  return text ? text.replace(/\n+$/, "").split("\n").length : 0;
}

export function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim()) ?? "";
}

export function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export class SummaryLine implements Component {
  private readonly text: string;
  private readonly suffix: string;
  constructor(text: string, suffix = "") {
    this.text = text.replace(/\n/g, " ↵ ");
    this.suffix = suffix.replace(/\n/g, " ");
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const suffixWidth = visibleWidth(this.suffix);
    if (!this.suffix) return [truncateToWidth(this.text, width, "…")];
    if (suffixWidth >= width) return [truncateToWidth(this.suffix, width, "…")];
    const budget = width - suffixWidth - 1;
    return [truncateToWidth(`${budget > 0 ? truncateToWidth(this.text, budget, "…") + " " : ""}${this.suffix}`, width, "…")];
  }
  invalidate(): void {}
}

export class IndentedResult implements Component {
  constructor(private readonly body: Component) {}
  render(width: number): string[] {
    if (width < 1) return [];
    const indent = Math.min(4, Math.max(0, width - 1));
    const rows = this.body.render(Math.max(1, width - indent));
    return rows.map((row, index) => {
      const prefix = index === 0 ? "  ⎿ " : "    ";
      return truncateToWidth(prefix.slice(0, indent) + row, width, "…");
    });
  }
  invalidate(): void { this.body.invalidate(); }
}

export class TidyShell extends Box {
  private call?: Component;
  private result?: Component;
  constructor() { super(1, 1); }
  update(theme: Theme, partial: boolean, error: boolean): void {
    this.setBgFn((text) => theme.bg(partial ? "toolPendingBg" : error ? "toolErrorBg" : "toolSuccessBg", text));
  }
  setCall(component: Component): void { this.call = component; this.rebuild(); }
  setResult(component: Component): void { this.result = component; this.rebuild(); }
  private rebuild(): void {
    this.clear();
    if (this.call) this.addChild(this.call);
    if (this.result) this.addChild(this.result);
  }
  render(width: number): string[] {
    if (width < 1) return [];
    return super.render(width).map((line) => truncateToWidth(line, width, "…"));
  }
}

const panelColors = { dark: parseColor("#28332b"), light: parseColor("#e7ece6") };
const toolColors = {
  dark: { read: parseColor("#93c2b3"), edit: parseColor("#b59bd5"), bash: parseColor("#7dbfa6") },
  light: { read: parseColor("#326d5c"), edit: parseColor("#76509a"), bash: parseColor("#326d5c") },
};
const parallelColors = { dark: parseColor("#a5b6c6"), light: parseColor("#536879") };
export function parallelLabel(theme: Theme): string {
  return theme.style("parallel", { fg: parallelColors[theme.appearance] });
}
export function toolLabel(name: string, text: string, theme: Theme): string {
  const kind = name === "edit" || name === "write" ? "edit" : name === "bash" ? "bash" : "read";
  return theme.style(text, { fg: toolColors[theme.appearance][kind] });
}

/** Truncation may insert SGR 0: restore the panel after resets inside the row. */
export function panelLine(text: string, width: number, theme: Theme): string {
  const background = backgroundAnsi(panelColors[theme.appearance], theme.getColorMode());
  const padded = text + " ".repeat(Math.max(0, width - visibleWidth(text)));
  return background + padded.replace(/\x1b\[(?:0|49)?m/g, reset => reset + background) + "\x1b[49m";
}

export function fullText(text: string, theme: Theme, error = false): Component {
  return new Text(theme.fg(error ? "error" : "toolOutput", text), 0, 0);
}
