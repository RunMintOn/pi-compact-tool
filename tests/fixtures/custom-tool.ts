import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { decorateTool } from "../../src/display.ts";

export default function customToolFixture(pi: ExtensionAPI): void {
  for (const name of ["ffgrep", "fffind"]) pi.registerTool(defineTool({
    name, label: name, description: "Unwrapped search fixture",
    defaultActive: false, exposure: "deferred", annotations: { readOnlyHint: true },
    parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }),
    async execute(_id, args) {
      return { content: [{ type: "text" as const, text: args.pattern + "\nsecond match" }], details: { totalMatched: 2 } };
    },
    renderCall: () => new Text("original search fixture", 0, 0),
  }));
  const tool = defineTool({
    name: "compact_test_search",
    label: "Test Search",
    description: "Local test tool",
    exposure: "deferred",
    namespace: { name: "test", description: "Test tools" },
    annotations: { readOnlyHint: true },
    parameters: Type.Object({ query: Type.String() }),
    async execute(_id, args) {
      return { content: [{ type: "text", text: args.query + "\nsecond match" }], details: { count: 2 } };
    },
  });
  pi.registerTool(decorateTool(tool, {
    kind: "search",
    target: (args) => String(args.query),
    summary: () => "2 matches",
  }));
}
