import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { decorateTool } from "../../src/display.ts";

export default function customToolFixture(pi: ExtensionAPI): void {
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
