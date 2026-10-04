import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type DisplayContext = Parameters<NonNullable<ToolDefinition<any, any, any>["renderCall"]>>[2];

export type DisplayStyle = "aggregate" | "tidy" | "claude";
export type CodemodeView = "compact" | "calls";
export const toolColorNames = ["green", "blue", "cyan", "purple", "amber", "orange", "pink", "gray"] as const;
export type ToolColor = typeof toolColorNames[number];
export type ColorTool = "bash" | "codemode";
const defaultToolColors: Record<ColorTool, ToolColor> = { bash: "green", codemode: "amber" };
export interface DisplayPreferences {
  codemodeView: CodemodeView;
  showThinking: boolean;
}
export const defaultPreferences: DisplayPreferences = { codemodeView: "compact", showThinking: true };
interface DisplayState {
  colors: Record<ColorTool, ToolColor>;
  preferences: DisplayPreferences;
  style: DisplayStyle;
  rows: Map<object, () => void>;
}
// Cooperative custom tools can import the decorator through a different extension module root.
const key = Symbol.for("pi-compact-tool.display-state.v1");
const shared = globalThis as typeof globalThis & { [key]?: DisplayState };
const state = shared[key] ??= { style: "aggregate", preferences: { ...defaultPreferences }, colors: { ...defaultToolColors }, rows: new Map() };
state.preferences ??= { ...defaultPreferences };
state.colors ??= { ...defaultToolColors };

export function getToolColor(tool: ColorTool): ToolColor { return state.colors[tool]; }
export function setToolColor(tool: ColorTool, color: ToolColor | "reset"): void {
  state.colors[tool] = color === "reset" ? defaultToolColors[tool] : color;
  refreshDisplayRows();
}

export function getDisplayPreferences(): DisplayPreferences { return { ...state.preferences }; }
export function setDisplayPreferences(preferences: DisplayPreferences): void {
  state.preferences = { ...preferences };
  refreshDisplayRows();
}
export function setCodemodeView(codemodeView: CodemodeView): void {
  setDisplayPreferences({ ...state.preferences, codemodeView });
}
export function setShowThinking(showThinking: boolean): void {
  setDisplayPreferences({ ...state.preferences, showThinking });
}

export function getDisplayStyle(): DisplayStyle {
  return state.style;
}

export function trackRow(context: DisplayContext): void {
  state.rows.set(context.state, context.invalidate);
}

export function setDisplayStyle(style: DisplayStyle): void {
  if (state.style === style) return;
  state.style = style;
  refreshDisplayRows();
}

export function refreshDisplayRows(): void {
  for (const invalidate of [...state.rows.values()]) invalidate();
}

export function resetDisplayState(style: DisplayStyle = state.style, preferences: DisplayPreferences = defaultPreferences): void {
  state.style = style;
  state.preferences = { ...preferences };
  state.colors = { ...defaultToolColors };
  state.rows.clear();
}
