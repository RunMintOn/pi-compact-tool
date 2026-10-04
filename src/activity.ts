import { AssistantMessageComponent, ToolExecutionComponent, sessionEntryToContextMessages, type Theme } from "@earendil-works/pi-coding-agent";
import { hyperlink, MouseRegion, Spacer, truncateToWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { getDisplayPreferences, getDisplayStyle } from "./state.ts";
import { adaptCustomTool } from "./custom-tools.ts";
import { lineCount, panelLine, parallelLabel, SummaryLine, toolLabel } from "./render-utils.ts";

// Reversible layout patches join native thinking and tools into a display panel.
// Native content, expansion state, mouse handlers and image protocols stay in charge.
export const ACTIVITY_ENTRY = "compact-tool.activity.v1";
type Message = { role: string; timestamp?: number; content?: unknown; stopReason?: string; toolCallId?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } } };
interface Call { id: string; name: string; }
interface Batch { ids: string[]; observed: boolean; }
interface ToolRegion { ids: string[]; }
interface Timing { start?: number; end?: number; parallel: boolean; lines?: number; }
export interface ChangeLink { label: string; url?: string; }
export interface ActivitySummary {
  changes?: ChangeLink;
  calls: number;
  turns: number;
  counts: Map<string, number>;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost?: number;
  start?: number;
  end?: number;
  toolMs?: number;
  tps?: number;
}
interface Request extends ActivitySummary { ids: string[]; finalKey?: string; }
export interface TimingRecord {
  calls: Array<{ id: string; start?: number; end?: number; parallel: boolean; lines?: number }>; 
  finalKey?: string;
  start?: number;
  end?: number;
  tps?: number;
  tpsBasis?: "excluding-tools";
}
function calls(message: Message): Call[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.filter((block): block is Call & { type: string } => block?.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string");
}
function key(message: Message): string {
  return calls(message)[0]?.id ?? `assistant:${message.timestamp}`;
}
function thinkingId(message: Message, run: number): string { return `${key(message)}:thinking:${run}`; }
function terminal(message: Message): boolean {
  return message.role === "assistant" && calls(message).length === 0 && ["stop", "error", "aborted", "length"].includes(message.stopReason ?? "");
}

/** Display-only projection of the active transcript; no messages or tool results are changed. */
export class ActivityProjection {
  private batches = new Map<string, Batch>();
  private regions = new Map<string, ToolRegion>();
  private hiddenRegionIds = new WeakMap<ToolRegion, { length: number; ids: string[] }>();
  private currentRegion?: ToolRegion;
  private timings = new Map<string, Timing>();
  private summaries = new Map<string, Request>();
  private changes = new Map<string, ChangeLink>();
  private seen = new Set<string>();
  private current?: Request;
  private agentStartMs: number | null = null;

  agentStarted(now: number): void { this.agentStartMs = now; }
  agentEnded(messages: readonly Message[], now: number): void {
    if (this.agentStartMs === null) return;
    const start = this.agentStartMs;
    this.agentStartMs = null;
    const ids = messages.flatMap(message => message.role === "assistant" ? calls(message).map(call => call.id) : []);
    const toolMs = this.toolWallMs(ids, start, now);
    if (toolMs === undefined) return;
    const elapsedMs = now - start - toolMs;
    if (elapsedMs <= 0) return;
    const output = messages.reduce((total, message) => total + (message.role === "assistant" ? message.usage?.output || 0 : 0), 0);
    if (output <= 0) return;
    const final = [...messages].reverse().find(terminal);
    const request = final ? this.summaries.get(key(final)) : undefined;
    if (request) request.tps = output / (elapsedMs / 1000);
  }

  ingest(message: Message): void {
    if (message.role === "user") {
      this.currentRegion = undefined;
      this.current = { calls: 0, turns: 0, counts: new Map(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ids: [], start: message.timestamp };
      return;
    }
    if (message.role !== "assistant") return;
    const messageKey = key(message);
    if (this.seen.has(messageKey)) return;
    this.seen.add(messageKey);
    this.current ??= { calls: 0, turns: 0, counts: new Map(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ids: [], start: message.timestamp };
    const request = this.current;
    if (request.finalKey) this.summaries.delete(request.finalKey);
    request.finalKey = undefined;
    request.tps = undefined;
    request.turns++;
    for (const metric of ["input", "output", "cacheRead", "cacheWrite"] as const) request.usage[metric] += message.usage?.[metric] ?? 0;
    if (message.usage?.cost?.total !== undefined) request.cost = (request.cost ?? 0) + message.usage.cost.total;
    const toolCalls = calls(message);
    const batch = { ids: toolCalls.map(call => call.id), observed: false };
    const addNode = (id: string) => {
      this.currentRegion ??= { ids: [] };
      this.currentRegion.ids.push(id);
      this.regions.set(id, this.currentRegion);
    };
    const blocks = Array.isArray(message.content) ? message.content : [];
    let run = 0;
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (block?.type === "text" && block.text?.trim()) this.currentRegion = undefined;
      if (block?.type === "thinking") {
        let visible = false;
        while (index < blocks.length && blocks[index]?.type === "thinking") {
          visible ||= Boolean(blocks[index].thinking?.trim());
          index++;
        }
        index--;
        if (visible) addNode(thinkingId(message, run++));
      }
      if (block?.type === "toolCall" && toolCalls.some(call => call.id === block.id)) addNode(block.id);
    }
    for (const call of toolCalls) {
      this.batches.set(call.id, batch);
      request.ids.push(call.id);
      request.calls++;
      request.counts.set(call.name, (request.counts.get(call.name) ?? 0) + 1);
    }
    if (terminal(message)) {
      request.finalKey = messageKey;
      request.end = message.timestamp;
      this.summaries.set(messageKey, request);
      this.currentRegion = undefined;
    }
  }

  rebuild(entries: readonly unknown[]): void {
    this.batches.clear(); this.regions.clear(); this.currentRegion = undefined;
    this.timings.clear(); this.summaries.clear(); this.seen.clear(); this.current = undefined; this.agentStartMs = null;
    for (const value of entries) {
      const entry = value as { type: string; message?: Message; retainedTail?: unknown[] };
      if (entry.type === "message" && entry.message) {
        this.ingest(entry.message);
        const persistedAt = Date.parse((value as { timestamp?: string }).timestamp ?? "");
        if (terminal(entry.message) && Number.isFinite(persistedAt)) this.completed(entry.message, persistedAt);
      }
      if (entry.type === "compaction" && Array.isArray(entry.retainedTail)) {
        for (const message of sessionEntryToContextMessages(entry as never)) this.ingest(message as Message);
      }
    }
    for (const value of entries) {
      const entry = value as { type: string; customType?: string; data?: TimingRecord };
      if (entry.type === "custom" && entry.customType === ACTIVITY_ENTRY && entry.data) this.restoreTiming(entry.data);
    }
  }

  hasNode(id: string): boolean { return this.regions.has(id); }
  hasTools(id: string): boolean { return this.regions.get(id)?.ids.some(node => this.batches.has(node)) ?? false; }
  private visibleIds(id: string): string[] | undefined {
    const region = this.regions.get(id);
    if (!region || getDisplayPreferences().showThinking) return region?.ids;
    const cached = this.hiddenRegionIds.get(region);
    if (cached?.length === region.ids.length) return cached.ids;
    const ids = region.ids.filter(node => this.batches.has(node));
    this.hiddenRegionIds.set(region, { length: region.ids.length, ids });
    return ids;
  }
  startsBlock(id: string): boolean { return this.visibleIds(id)?.[0] === id; }
  endsBlock(id: string): boolean { return this.visibleIds(id)?.at(-1) === id; }
  nextInBlock(id: string): string | undefined {
    const ids = this.visibleIds(id);
    const index = ids?.indexOf(id) ?? -1;
    return index >= 0 ? ids?.[index + 1] : undefined;
  }

  parallelCount(id: string): number {
    const batch = this.batches.get(id);
    return batch?.ids[0] === id && this.isParallel(id) ? batch.ids.length : 0;
  }
  startsSection(id: string): boolean {
    const ids = this.visibleIds(id);
    const index = ids?.indexOf(id) ?? -1;
    if (!ids || index <= 0) return false;
    if (!this.batches.has(id)) return this.hasTools(id);
    const previous = ids[index - 1]!;
    return this.batches.has(previous) && this.batches.has(id) && this.batches.get(previous) !== this.batches.get(id) && (this.isParallel(previous) || this.isParallel(id));
  }

  isParallel(id: string): boolean {
    const batch = this.batches.get(id);
    if (!batch) return false;
    // Old sessions have no execution events: multiple calls in the same assistant
    // message identify the parallel dispatch group, not measured CPU overlap.
    // Mark the whole dispatch group, not each call's individual overlap interval.
    return batch.observed ? batch.ids.some(peer => this.timings.get(peer)?.parallel === true) : batch.ids.length > 1;
  }
  started(id: string, now: number): void {
    const batch = this.batches.get(id);
    if (!batch) return;
    batch.observed = true;
    const timing: Timing = { start: now, parallel: false };
    this.timings.set(id, timing);
    for (const peer of batch.ids) {
      const previous = this.timings.get(peer);
      if (peer !== id && previous?.start !== undefined && previous.end === undefined) {
        timing.parallel = true; previous.parallel = true;
      }
    }
  }
  ended(id: string, now: number, bashResult?: unknown): void {
    const timing = this.timings.get(id);
    if (!timing) return;
    timing.end = now;
    const result = bashResult as { structuredContent?: { output?: string }; details?: { truncation?: { outputLines?: number } } } | undefined;
    if (typeof result?.structuredContent?.output === "string") {
      // Native Bash's text includes empty-output/status notices. Count supplied
      // output data instead; do not read the full-output file or alter the result.
      timing.lines = result.details?.truncation?.outputLines ?? lineCount(result.structuredContent.output);
    }
  }
  bashLines(id: string): number | undefined { return this.timings.get(id)?.lines; }
  completed(message: Message, now: number): void {
    const request = this.summaries.get(key(message));
    if (request) request.end = now;
  }
  setChanges(finalKey: string, link: ChangeLink): void { this.changes.set(finalKey, link); }
  clearChanges(): void { this.changes.clear(); }
  private toolWallMs(ids: readonly string[], lower = -Infinity, upper = Infinity): number | undefined {
    const intervals: Array<[number, number]> = [];
    for (const id of new Set(ids)) {
      const timing = this.timings.get(id);
      if (timing?.start === undefined || timing.end === undefined) return undefined;
      if (!Number.isFinite(timing.start) || !Number.isFinite(timing.end) || timing.end < timing.start) return undefined;
      const start = Math.max(lower, timing.start);
      const end = Math.min(upper, timing.end);
      if (end > start) intervals.push([start, end]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let total = 0;
    let previousEnd = -Infinity;
    for (const [start, end] of intervals) {
      total += Math.max(0, end - Math.max(start, previousEnd));
      previousEnd = Math.max(previousEnd, end);
    }
    return total;
  }
  summaryFor(message: Message): ActivitySummary | undefined {
    const messageKey = key(message);
    const request = this.summaries.get(messageKey);
    return request?.calls ? { ...request, toolMs: this.toolWallMs(request.ids, request.start, request.end), changes: this.changes.get(messageKey) } : undefined;
  }
  timingRecord(): TimingRecord {
    const request = this.current;
    return { calls: (request?.ids ?? []).flatMap(id => {
      const timing = this.timings.get(id);
      return timing ? [{ id, ...timing }] : [];
    }), finalKey: request?.finalKey, start: request?.start, end: request?.end, tps: request?.tps, tpsBasis: "excluding-tools" };
  }
  restoreTiming(record: TimingRecord): void {
    if (!Array.isArray(record.calls)) return;
    for (const timing of record.calls) {
      const batch = this.batches.get(timing.id);
      if (batch) { batch.observed = true; this.timings.set(timing.id, timing); }
    }
    const request = record.finalKey ? this.summaries.get(record.finalKey) : undefined;
    if (request) { request.start = record.start ?? request.start; request.end = record.end ?? request.end; request.tps = record.tpsBasis === "excluding-tools" ? record.tps : undefined; }
  }
}

function tokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${Number((count / 1000).toFixed(1))}k`;
  return `${Number((count / 1_000_000).toFixed(1))}M`;
}
function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
function clock(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function renderActivitySummary(summary: ActivitySummary, theme: Theme, width: number, outputPad = 1): string[] {
  if (width < 1) return [];
  const counts = [...summary.counts].map(([name, count]) => toolLabel(name, `${name} ×${count}`, theme)).join(" · ");
  const heading = `${theme.fg("muted", `${summary.calls} calls · ${summary.turns} turns`)} · ${counts}`;
  const parts: string[] = [];
  if (summary.start !== undefined && summary.end !== undefined) {
    const tools = summary.toolMs !== undefined ? ` (tools ${duration(summary.toolMs)})` : "";
    parts.push(`total ${duration(summary.end - summary.start)}${tools}`);
  }
  if (summary.tps !== undefined) parts.push(`TPS ${summary.tps.toFixed(1)} tok/s`);
  if (summary.cost !== undefined) parts.push(`$${summary.cost.toFixed(3)}`);
  parts.push(`tokens ↑${tokens(summary.usage.input)} ↓${tokens(summary.usage.output)}`);
  if (summary.usage.cacheRead) parts.push(`cache read ${tokens(summary.usage.cacheRead)}`);
  if (summary.usage.cacheWrite) parts.push(`cache write ${tokens(summary.usage.cacheWrite)}`);
  const date = summary.end !== undefined ? theme.fg("muted", `· ${clock(summary.end)}`) : "";
  const contentWidth = Math.max(1, width - outputPad * 2);
  const stats = new SummaryLine(theme.fg("muted", parts.join(" · ")), date).render(contentWidth)[0] ?? "";
  const change = summary.changes;
  const label = change?.url && contentWidth < 12 ? "Changes" : change?.label ?? "";
  const suffix = change?.url ? " " + hyperlink(`\x1b[4m${theme.fg("accent", label)}\x1b[24m`, change.url) : theme.fg("muted", label);
  const first = new SummaryLine(heading, suffix).render(contentWidth)[0] ?? "";
  return ["", ...[first, stats].map(text => truncateToWidth(" ".repeat(outputPad) + truncateToWidth(text, contentWidth, "…"), width, "…"))];
}

const sharedKey = Symbol.for("pi-compact-tool.activity-ui.v1");
interface Installed { projection: ActivityProjection; getOutputPad(): number; release(): void; }
const shared = globalThis as typeof globalThis & { [sharedKey]?: Installed };
export function transcriptPadding(): number { return shared[sharedKey]?.getOutputPad() ?? 1; }
export function bashOutputLines(id: string): number | undefined { return shared[sharedKey]?.projection.bashLines(id); }

/** Reversible patches, installed only in an interactive session and released on reload/shutdown. */
export function installActivityUI(projection: ActivityProjection, getTheme: () => Theme, getInitialOutputPad = () => 1): () => void {
  shared[sharedKey]?.release();
  let outputPad = getInitialOutputPad();
  const getOutputPad = () => outputPad;
  const tool = ToolExecutionComponent.prototype;
  const assistant = AssistantMessageComponent.prototype;
  const originalToolRender = tool.render;
  const originalMouse = tool.handleMouse;
  const originalAssistantRender = assistant.render;
  type NativeTool = { toolCallId: string; rendererState: { compactAggregate?: unknown }; selfRenderHeight: number; imageComponents: unknown[]; };
  type NativeAssistant = { lastMessage?: Message; isStreaming: boolean; outputPad: number; contentContainer: { children: Component[]; mouseLayout?: unknown } };
  const renderedAssistants = new Set<AssistantMessageComponent>();
  const adaptedTools = new Map<ToolExecutionComponent, () => void>();
  const compact = (instance: ToolExecutionComponent) => getDisplayStyle() === "aggregate" && Boolean((instance as unknown as NativeTool).rendererState.compactAggregate);
  function prefix(id: string, width: number): string[] {
    const theme = getTheme();
    const count = projection.parallelCount(id);
    return [
      ...(projection.startsBlock(id) ? ["", panelLine("", width, theme)] : projection.startsSection(id) ? [panelLine("", width, theme)] : []),
      ...(count ? [panelLine(truncateToWidth(" ".repeat(getOutputPad()) + truncateToWidth(`${parallelLabel(theme)}${theme.fg("muted", ` · ${count} calls`)}`, Math.max(1, width - getOutputPad() * 2), "…"), width, "…"), width, theme)] : []),
    ];
  }
  function toolRender(this: ToolExecutionComponent, width: number): string[] {
    if (!adaptedTools.has(this)) {
      const restore = adaptCustomTool(this);
      if (restore) adaptedTools.set(this, restore);
    }
    const rows = originalToolRender.call(this, width);
    if (!compact(this) || !rows.length || width < 1) return rows;
    const native = this as unknown as NativeTool;
    const id = native.toolCallId;
    const content = rows[0] === "" ? rows.slice(1) : rows;
    if (native.imageComponents.length) {
      // Keep native image rows and protocols in place; close the text panel before
      // the image and pad its continuation without duplicating section separators.
      const next = projection.nextInBlock(id);
      const padding = panelLine("", width, getTheme());
      return [
        ...prefix(id, width),
        ...content.slice(0, native.selfRenderHeight),
        padding,
        ...content.slice(native.selfRenderHeight),
        ...(next && !projection.startsSection(next) ? [padding] : []),
      ];
    }
    return [
      ...prefix(id, width),
      ...content,
      ...(projection.endsBlock(id) ? [panelLine("", width, getTheme())] : []),
    ];
  }
  function toolMouse(this: ToolExecutionComponent, event: TuiMouseEvent) {
    if (!compact(this)) return originalMouse.call(this, event);
    const prefixHeight = prefix((this as unknown as NativeTool).toolCallId, event.width).length;
    if (event.y < prefixHeight) return undefined;
    return originalMouse.call(this, { ...event, y: event.y - prefixHeight + 1 });
  }
  function assistantRender(this: AssistantMessageComponent, width: number): string[] {
    const native = this as unknown as NativeAssistant;
    // Native messages track /settings padding changes without a session API call.
    outputPad = native.outputPad;
    if (getDisplayStyle() !== "aggregate" || !native.lastMessage || width < 1) return originalAssistantRender.call(this, width);
    const children = native.contentContainer.children;
    const showThinking = getDisplayPreferences().showThinking;
    // A native MouseRegion in assistant content is a thinking run, not normal Markdown.
    const visibleChildren = showThinking ? children : children.filter((child, index) => {
      if (child instanceof MouseRegion) return false;
      if (!(child instanceof Spacer)) return true;
      if (index === 0) return children.some(other => !(other instanceof MouseRegion) && !(other instanceof Spacer));
      return !(children[index - 1] instanceof MouseRegion) && !(children[index + 1] instanceof MouseRegion);
    });
    let run = 0;
    const thinking = new Map<Component, string>();
    for (const child of children) {
      if (!(child instanceof MouseRegion)) continue;
      const id = thinkingId(native.lastMessage, run++);
      if (projection.hasNode(id) ? projection.hasTools(id) : calls(native.lastMessage).length > 0) thinking.set(child, id);
    }
    const decorated = visibleChildren.map((child, index): Component => {
      if (child instanceof Spacer && thinking.has(visibleChildren[index + 1]!)) {
        return { render: () => [], invalidate() {} };
      }
      const id = thinking.get(child);
      if (!id || !(child instanceof MouseRegion)) return child;
      const known = projection.hasNode(id);
      const first = known ? projection.startsBlock(id) : index <= 1 || !(children[index - 1] instanceof MouseRegion);
      const last = known ? projection.endsBlock(id) : false;
      let bodyHeight = 0;
      const prefixHeight = first ? 2 : 1;
      return {
        render: (availableWidth) => {
          const body = child.render(availableWidth);
          bodyHeight = body.length;
          const padding = panelLine("", availableWidth, getTheme());
          return [
            ...(first ? ["", padding] : [padding]),
            ...body.map(row => panelLine(row, availableWidth, getTheme())),
            ...(last ? [padding] : []),
          ];
        },
        handleMouse: (event) => event.y < prefixHeight || event.y >= prefixHeight + bodyHeight ? undefined
          : child.handleMouse({ ...event, y: event.y - prefixHeight, height: bodyHeight }),
        invalidate: () => child.invalidate(),
      };
    });
    // Render through the native containers so their cached mouse layouts use the
    // decorated heights. The wrappers forward clicks to the original MouseRegion.
    native.contentContainer.children = decorated;
    renderedAssistants.add(this);
    let rows: string[];
    try { rows = originalAssistantRender.call(this, width); }
    finally { native.contentContainer.children = children; }
    const summary = native.isStreaming ? undefined : projection.summaryFor(native.lastMessage);
    return summary ? [...rows, ...renderActivitySummary(summary, getTheme(), width, native.outputPad)] : rows;
  }
  tool.render = toolRender;
  tool.handleMouse = toolMouse;
  assistant.render = assistantRender;
  const installed: Installed = { projection, getOutputPad, release() {
    if (tool.render === toolRender) tool.render = originalToolRender;
    if (tool.handleMouse === toolMouse) tool.handleMouse = originalMouse;
    if (assistant.render === assistantRender) assistant.render = originalAssistantRender;
    for (const component of renderedAssistants) {
      (component as unknown as NativeAssistant).contentContainer.mouseLayout = undefined;
      (component as unknown as { mouseLayout?: unknown }).mouseLayout = undefined;
    }
    renderedAssistants.clear();
    for (const restore of adaptedTools.values()) restore();
    adaptedTools.clear();
    if (shared[sharedKey] === installed) delete shared[sharedKey];
  } };
  shared[sharedKey] = installed;
  return installed.release;
}
