import type { Theme, ToolDefinition, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { builtInKinds, decorateTool, getToolDecoration, type DisplayAdapter } from "./display.ts";
import { transcriptPadding } from "./activity.ts";
import { firstLine, lineCount, panelLine, plural, textOutput } from "./render-utils.ts";
import { patchOperations } from "./patch.ts";
import { getDisplayPreferences, getDisplayStyle } from "./state.ts";

function adapter(name: string): DisplayAdapter | undefined {
  if (name === "bash") return { kind: "bash" };
  if (name === "apply_patch") return {
    kind: "edit",
    target: args => {
      const targets: string[] = [];
      for (const operation of patchOperations(String(args.patch ?? ""))) {
        if (operation.op === "move") {
          if (targets.length) targets[targets.length - 1] += ` → ${operation.path}`;
        } else targets.push(operation.path);
      }
      return targets.join(", ") || "…";
    },
    summary: result => {
      const changes = (result.details as { changes?: unknown } | undefined)?.changes;
      if (Array.isArray(changes)) {
        if (!changes.length) return "no changes";
        let added = 0;
        let removed = 0;
        const hasStats = changes.every(change => {
          if (!change || typeof change !== "object") return false;
          const { additions, deletions } = change as { additions?: unknown; deletions?: unknown };
          if (typeof additions !== "number" || !Number.isInteger(additions) || additions < 0 ||
              typeof deletions !== "number" || !Number.isInteger(deletions) || deletions < 0) return false;
          added += additions; removed += deletions;
          return true;
        });
        return plural(changes.length, "file") + (hasStats ? ` +${added} -${removed}` : "");
      }
      const output = textOutput(result);
      const files = output.split("\n").filter(line => /^[AMD] .+/.test(line)).length;
      return files ? plural(files, "file") : firstLine(output) || "done";
    },
  };
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

function nativePanel(component: Component, theme: Theme, pending: boolean, callsOnly = false): Component {
  return {
    render(width) {
      if (getDisplayStyle() !== "aggregate") return component.render(width);
      const padding = transcriptPadding();
      const rows = component.render(Math.max(1, width - padding * 2));
      // The native result begins its call region with a spacer. Compact rows are contiguous.
      if (callsOnly && rows[0] === "") rows.shift();
      return rows.map(row => panelLine(truncateToWidth(" ".repeat(padding) + row, width, "…"), width, theme, pending));
    },
    invalidate: () => component.invalidate(),
  };
}

/**
 * Replace only a TUI component's definition, never the registered/executing tool.
 *
 * `adaptUnregisteredBuiltIns` covers the built-ins this extension registers with
 * `compactRendering` off: they carry no adapter of their own, so they are given
 * the generic shell here instead of at registration time.
 */
export function adaptCustomTool(component: ToolExecutionComponent, adaptUnregisteredBuiltIns = false): (() => void) | undefined {
  type Native = {
    toolName: string;
    toolDefinition?: ToolDefinition<any>;
    children: Component[];
    selfRenderContainer: Component;
    contentBox: Component;
    callRendererComponent?: Component;
    resultRendererComponent?: Component;
    rendererState: Record<string, unknown>;
  };
  const native = component as unknown as Native;
  const decoration = native.toolDefinition && getToolDecoration(native.toolDefinition);
  // Built-ins that this extension registers itself carry no adapter of their own;
  // they get the generic shell when adapted in the TUI layer. The name list lives
  // in display.ts so it cannot drift from the registered built-ins.
  const isBuiltIn = adaptUnregisteredBuiltIns && native.toolName in builtInKinds;
  const displayAdapter = decoration?.adapter ?? adapter(native.toolName) ?? (isBuiltIn ? {} : undefined);
  const original = decoration?.original ?? native.toolDefinition;
  if (!displayAdapter || !original) return undefined;
  const decorated = decorateTool({ ...original, name: native.toolName },
    native.toolName === "apply_patch" && original.renderResult
      ? { ...displayAdapter, renderExpanded: original.renderResult }
      : displayAdapter);
  if (native.toolName === "codemode") {
    const renderCall = decorated.renderCall!;
    const renderResult = decorated.renderResult!;
    decorated.renderCall = (args, theme, context) => {
      const compact = renderCall(args, theme, context);
      return context.expanded && original.renderCall
        ? nativePanel(original.renderCall(args, theme, { ...context, lastComponent: undefined }), theme, context.isPartial) : compact;
    };
    decorated.renderResult = (result, options, theme, context) => {
      const compact = renderResult(result, options, theme, context);
      if (options.expanded && original.renderResult) {
        return nativePanel(original.renderResult(result, options, theme, { ...context, lastComponent: undefined }), theme, options.isPartial);
      }
      const calls = (result.details as { calls?: unknown[] } | undefined)?.calls;
      if (getDisplayStyle() === "aggregate" && getDisplayPreferences().codemodeView === "calls" && calls?.length && original.renderResult) {
        // Empty content isolates the native nested-call region without copying its formatting.
        return nativePanel(original.renderResult({ ...result, content: [] }, { ...options, expanded: true }, theme, { ...context, lastComponent: undefined }), theme, options.isPartial, true);
      }
      return compact;
    };
  }
  const framing = decoration
    ? original.renderShell === "self" ? native.selfRenderContainer : native.contentBox
    : native.children[1]!;
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
