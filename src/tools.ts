import {
  createBashToolDefinition, createEditToolDefinition, createFindToolDefinition,
  createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition,
  createWriteToolDefinition, type ExtensionAPI, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { builtInKinds, decorateTool, type BuiltInName, type DisplayKind } from "./display.ts";
import type { ChangeTracker } from "./changes.ts";
import { getDisplayStyle } from "./state.ts";

type Settings = ReturnType<ExtensionAPI["getSettings"]>;
// The registered built-ins and their display kinds both come from display.ts, so
// there is one name list to update when Pi adds a built-in tool.
const kinds = builtInKinds;

function official(name: BuiltInName, cwd: string, settings: Settings, changes?: ChangeTracker): ToolDefinition<any, any, any> {
  const trackedWrite = async (path: string, content: string) => {
    // The official tool has already resolved the path and holds its mutation queue.
    if (getDisplayStyle() !== "off") await changes!.captureBefore(path);
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

export function createDisplayTools(getSettings: () => Settings, changes?: ChangeTracker, compactRendering = true): ToolDefinition<any>[] {
  const cache = new Map<string, ToolDefinition<any>>();
  return (Object.keys(kinds) as BuiltInName[]).map((name) => {
    const base = official(name, process.cwd(), {});
    const tool: ToolDefinition<any> = {
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
    };
    return compactRendering ? decorateTool(tool, { kind: kinds[name] }) : tool;
  });
}
