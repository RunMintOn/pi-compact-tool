import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type DisplayContext = Parameters<NonNullable<ToolDefinition<any, any, any>["renderCall"]>>[2];

export type DisplayStyle = "aggregate" | "tidy" | "claude";
interface DisplayState {
  style: DisplayStyle;
  rows: Map<object, () => void>;
}
// Cooperative custom tools can import the decorator through a different extension module root.
const key = Symbol.for("pi-compact-tool.display-state.v1");
const shared = globalThis as typeof globalThis & { [key]?: DisplayState };
const state = shared[key] ??= { style: "aggregate", rows: new Map() };

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

export function resetDisplayState(style: DisplayStyle = state.style): void {
  state.style = style;
  state.rows.clear();
}
