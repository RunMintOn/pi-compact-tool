import {
  createBashToolDefinition, createEditToolDefinition, createFindToolDefinition,
  createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition,
  createWriteToolDefinition, type ExtensionAPI, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { decorateTool, type DisplayKind } from "./display.ts";
import type { ChangeTracker } from "./changes.ts";

type Settings = ReturnType<ExtensionAPI["getSettings"]>;
const kinds = { read: "read", bash: "bash", edit: "edit", write: "write", grep: "search", find: "search", ls: "search" } as const satisfies Record<string, DisplayKind>;
type BuiltInName = keyof typeof kinds;

function official(name: BuiltInName, cwd: string, settings: Settings, changes?: ChangeTracker): ToolDefinition<any, any, any> {
  const trackedWrite = async (path: string, content: string) => {
    // The official tool has already resolved the path and holds its mutation queue.
    await changes!.captureBefore(path);
    await writeFile(path, content, "utf8");
  };
  const factories = {
    read: () => createReadToolDefinition(cwd, { autoResizeImages: settings.images?.autoResize ?? true }),
    bash: () => createBashToolDefinition(cwd, { shellPath: settings.shellPath, commandPrefix: settings.shellCommandPrefix }),
    edit: () => createEditToolDefinition(cwd, changes ? { operations: {
      readFile: path => readFile(path),
      access: path => access(path, constants.R_OK | constants.W_OK),
      writeFile: trackedWrite,
    } } : undefined),
    write: () => createWriteToolDefinition(cwd, changes ? { operations: {
      mkdir: dir => mkdir(dir, { recursive: true }).then(() => {}),
      writeFile: trackedWrite,
    } } : undefined),
    grep: () => createGrepToolDefinition(cwd),
    find: () => createFindToolDefinition(cwd),
    ls: () => createLsToolDefinition(cwd),
  };
  return factories[name]() as ToolDefinition<any, any, any>;
}

export function createDisplayTools(getSettings: () => Settings, changes?: ChangeTracker): ToolDefinition<any>[] {
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
          definition = official(name, ctx.cwd, settings, changes);
          cache.set(key, definition);
        }
        return definition.execute(toolCallId, params, signal, onUpdate, ctx);
      },
    }, { kind: kinds[name] });
  });
}
