import {
  createBashToolDefinition, createEditToolDefinition, createFindToolDefinition,
  createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition,
  createWriteToolDefinition, type ExtensionAPI, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { decorateTool, type DisplayKind } from "./display.ts";

type Settings = ReturnType<ExtensionAPI["getSettings"]>;
const kinds = { read: "read", bash: "bash", edit: "edit", write: "write", grep: "search", find: "search", ls: "search" } as const satisfies Record<string, DisplayKind>;
type BuiltInName = keyof typeof kinds;

function official(name: BuiltInName, cwd: string, settings: Settings): ToolDefinition<any, any, any> {
  const factories = {
    read: () => createReadToolDefinition(cwd, { autoResizeImages: settings.images?.autoResize ?? true }),
    bash: () => createBashToolDefinition(cwd, { shellPath: settings.shellPath, commandPrefix: settings.shellCommandPrefix }),
    edit: () => createEditToolDefinition(cwd),
    write: () => createWriteToolDefinition(cwd),
    grep: () => createGrepToolDefinition(cwd),
    find: () => createFindToolDefinition(cwd),
    ls: () => createLsToolDefinition(cwd),
  };
  return factories[name]() as ToolDefinition<any, any, any>;
}

export function createDisplayTools(getSettings: () => Settings): ToolDefinition<any>[] {
  const cache = new Map<string, ToolDefinition<any>>();
  return (Object.keys(kinds) as BuiltInName[]).map((name) => {
    const base = official(name, process.cwd(), {});
    return decorateTool({
      ...base,
      // Registering a display override must not enable a previously inactive built-in.
      defaultActive: false,
      execute(toolCallId, params, signal, onUpdate, ctx) {
        const settings = getSettings();
        const key = JSON.stringify([name, ctx.cwd, settings.shellPath, settings.shellCommandPrefix, settings.images?.autoResize]);
        let definition = cache.get(key);
        if (!definition) {
          definition = official(name, ctx.cwd, settings);
          cache.set(key, definition);
        }
        return definition.execute(toolCallId, params, signal, onUpdate, ctx);
      },
    }, { kind: kinds[name] });
  });
}
