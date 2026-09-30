import type { Theme, ToolDefinition, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { decorateTool, type DisplayAdapter } from "./display.ts";
import { transcriptPadding } from "./activity.ts";
import { firstLine, lineCount, panelLine, plural, textOutput } from "./render-utils.ts";
import { getDisplayStyle } from "./state.ts";

function adapter(name: string): DisplayAdapter | undefined {
  if (name === "ffgrep" || name === "fffind") return {
    kind: "search",
    target: args => `${args.pattern ?? ""} in ${args.path ?? "."}`,
    summary: result => {
      const count = (result.details as { totalMatched?: number } | undefined)?.totalMatched;
      if (typeof count === "number") return name === "fffind" ? plural(count, "file") : `${count} ${count === 1 ? "match" : "matches"}`;
      return plural(textOutput(result).split("\n").filter(line => line.trim()).length, "result line");
    },
  };
  if (name === "codemode") return {
    target: args => firstLine(String(args.code ?? "")),
    summary: result => {
      const calls = (result.details as { calls?: unknown[] } | undefined)?.calls;
      if (calls?.length) return plural(calls.length, "nested call");
      const [first, ...rest] = result.content;
      const hasHeader = first?.type === "text" && /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/.test(first.text ?? "");
      return plural(lineCount(textOutput({ content: hasHeader ? rest : result.content })), "line");
    },
  };
  return undefined;
}

function nativePanel(component: Component, theme: Theme): Component {
  return {
    render(width) {
      if (getDisplayStyle() !== "aggregate") return component.render(width);
      const padding = transcriptPadding();
      return component.render(Math.max(1, width - padding * 2)).map(row => panelLine(truncateToWidth(" ".repeat(padding) + row, width, "…"), width, theme));
    },
    invalidate: () => component.invalidate(),
  };
}

/** Replace only a TUI component's definition, never the registered/executing tool. */
export function adaptCustomTool(component: ToolExecutionComponent): (() => void) | undefined {
  type Native = {
    toolName: string;
    toolDefinition?: ToolDefinition<any>;
    children: Component[];
    selfRenderContainer: Component;
    callRendererComponent?: Component;
    resultRendererComponent?: Component;
    rendererState: Record<string, unknown>;
  };
  const native = component as unknown as Native;
  const displayAdapter = adapter(native.toolName);
  const original = native.toolDefinition;
  if (!displayAdapter || !original) return undefined;
  const decorated = decorateTool({ ...original, name: native.toolName }, displayAdapter);
  if (native.toolName === "codemode") {
    const renderCall = decorated.renderCall!;
    const renderResult = decorated.renderResult!;
    decorated.renderCall = (args, theme, context) => {
      const compact = renderCall(args, theme, context);
      return context.expanded && original.renderCall
        ? nativePanel(original.renderCall(args, theme, { ...context, lastComponent: undefined }), theme) : compact;
    };
    decorated.renderResult = (result, options, theme, context) => {
      const compact = renderResult(result, options, theme, context);
      return options.expanded && original.renderResult
        ? nativePanel(original.renderResult(result, options, theme, { ...context, lastComponent: undefined }), theme) : compact;
    };
  }
  const framing = native.children[1]!;
  function refresh() {
    native.callRendererComponent = undefined;
    native.resultRendererComponent = undefined;
    component.invalidate();
  }
  native.toolDefinition = decorated;
  native.children[1] = native.selfRenderContainer;
  refresh();
  return () => {
    native.toolDefinition = original;
    native.children[1] = framing;
    delete native.rendererState.compactAggregate;
    delete native.rendererState.compactToolShell;
    refresh();
  };
}
