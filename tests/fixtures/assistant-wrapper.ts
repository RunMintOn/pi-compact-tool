import { AssistantMessageComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Model a disabled assistant renderer installed after compact-tool, like raw mode.
export default function assistantWrapper(pi: ExtensionAPI): void {
  const prototype = AssistantMessageComponent.prototype;
  let restore: (() => void) | undefined;
  pi.on("session_start", () => {
    const original = prototype.render;
    function render(this: AssistantMessageComponent, width: number): string[] {
      return original.call(this, width);
    }
    prototype.render = render;
    restore = () => {
      if (prototype.render === render) prototype.render = original;
    };
  });
  pi.on("session_shutdown", () => restore?.());
}
