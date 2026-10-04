import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultPreferences, toolColorNames, type ToolColor, type DisplayPreferences } from "./state.ts";

export async function loadPreferences(path: string): Promise<DisplayPreferences> {
  let value: Partial<DisplayPreferences>;
  try { value = JSON.parse(await readFile(path, "utf8")) ?? {}; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultPreferences };
    throw error;
  }
  return {
    codemodeView: value.codemodeView === "calls" ? "calls" : "compact",
    showThinking: typeof value.showThinking === "boolean" ? value.showThinking : true,
    bashColor: toolColorNames.includes(value.bashColor as ToolColor) ? value.bashColor! : defaultPreferences.bashColor,
    codemodeColor: toolColorNames.includes(value.codemodeColor as ToolColor) ? value.codemodeColor! : defaultPreferences.codemodeColor,
  };
}

export async function savePreferences(path: string, patch: Partial<DisplayPreferences>): Promise<DisplayPreferences> {
  // Read the other preference again so a command does not overwrite another Pi instance's choice.
  const preferences = { ...await loadPreferences(path), ...patch };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(preferences, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
  return preferences;
}
