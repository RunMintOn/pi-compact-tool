import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssistantMessageComponent, createAgentSession, DefaultResourceLoader, initTheme,
  SessionManager, SettingsManager, type ExtensionUIContext, type Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { setShowThinking } from "../src/state.ts";

initTheme("dark", false);
const theme = {
  appearance: "dark", getColorMode: () => "truecolor",
  fg: (_: string, text: string) => text, bg: (_: string, text: string) => text,
  style: (text: string) => text, bold: (text: string) => text,
} as unknown as Theme;
const assistant = (text: string, timestamp: number, stopReason = "stop", cost = 0.1) => ({
  role: "assistant" as const, content: [{ type: "text" as const, text }], timestamp, stopReason,
  api: "openai-completions", provider: "openai", model: "test",
  usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } },
});
const plain = (component: AssistantMessageComponent) => component.render(160).map(stripTerminalSequences).join("\n");

async function fixture(extraExtensions: string[] = []) {
  const cwd = mkdtempSync(join(tmpdir(), "compact-lifecycle-"));
  const settingsManager = SettingsManager.inMemory({});
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir: cwd, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: [new URL("../index.ts", import.meta.url).pathname, ...extraExtensions],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSession({
    cwd, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(cwd),
  });
  await session.bindExtensions({
    mode: "tui", uiContext: { theme, notify() {} } as unknown as ExtensionUIContext,
  });
  const emit = async (event: any) => {
    await (session as any)._extensionRunner.emit(event);
    if (event.type === "message_end") session.sessionManager.appendMessage(event.message);
  };
  return { session, emit };
}

test("reload with a later assistant renderer keeps one summary for historical and latest replies", async () => {
  const originalRender = AssistantMessageComponent.prototype.render;
  const { session, emit } = await fixture([new URL("./fixtures/assistant-wrapper.ts", import.meta.url).pathname]);
  const messages = [assistant("historical reply", 2000), assistant("latest reply", 4000)];
  const components: AssistantMessageComponent[] = [];
  try {
    for (const message of messages) {
      await emit({ type: "message_end", message: { role: "user", content: "request", timestamp: message.timestamp - 1000 } });
      await emit({ type: "agent_start" });
      await emit({ type: "message_end", message });
      await emit({ type: "agent_end", messages: [message] });
      await emit({ type: "agent_settled", aborted: false });
      components.push(new AssistantMessageComponent(message as any, true));
    }
    const expected = components.map(plain);
    for (let reload = 0; reload < 5; reload++) {
      await session.reload();
      for (const [index, message] of messages.entries()) {
        for (const component of [components[index]!, new AssistantMessageComponent(message as any, true)]) {
          const rendered = plain(component);
          assert.equal((rendered.match(/tokens ↑/g) ?? []).length, 1, `reload ${reload + 1}, reply ${index + 1}`);
          assert.equal(rendered, expected[index]);
        }
      }
    }
  } finally {
    await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
    AssistantMessageComponent.prototype.render = originalRender;
  }
});

test("queued steering/follow-up share one settled summary, including after repeated reload", async (t) => {
  t.mock.method(Date, "now", () => 2000);
  const { session, emit } = await fixture();
  try {
    await emit({ type: "message_end", message: { role: "user", content: "start", timestamp: 1000 } });
    await emit({ type: "agent_start" });
    const tools = { ...assistant("", 1100, "toolUse"), content: [
      { type: "toolCall", id: "read-one", name: "read", arguments: { path: "sample" } },
    ] };
    await emit({ type: "message_end", message: tools });
    await emit({ type: "tool_execution_start", toolCallId: "read-one", toolName: "read", args: {} });
    await emit({ type: "tool_execution_end", toolCallId: "read-one", toolName: "read", result: {}, isError: false });
    const first = assistant("intermediate", 1200);
    await emit({ type: "message_end", message: first });
    const firstComponent = new AssistantMessageComponent(first as any, true);
    assert.doesNotMatch(plain(firstComponent), /calls|tokens|total /);
    await emit({ type: "session_compact" });
    assert.doesNotMatch(plain(firstComponent), /calls|tokens|total /);
    await emit({ type: "message_end", message: { role: "user", content: "steering", timestamp: 1300 } });
    const second = assistant("follow-up answer", 1400);
    await emit({ type: "message_end", message: second });
    await emit({ type: "agent_end", messages: [tools, first, second] });
    assert.doesNotMatch(plain(new AssistantMessageComponent(second as any, true)), /tokens/);
    await emit({ type: "agent_start" });
    await emit({ type: "message_end", message: { role: "user", content: "follow-up", timestamp: 1500 } });
    const final = assistant("final answer", 1600);
    await emit({ type: "message_end", message: final });
    await emit({ type: "agent_end", messages: [final] });
    await emit({ type: "agent_settled", aborted: false });
    const finalComponent = new AssistantMessageComponent(final as any, true);
    const expected = plain(finalComponent);
    assert.match(expected, /1 calls · 4 turns/);
    assert.match(expected, /\$0\.400 · tokens ↑400 ↓80/);
    assert.doesNotMatch(plain(firstComponent), /tokens/);
    assert.doesNotMatch(plain(new AssistantMessageComponent(second as any, true)), /tokens/);
    for (let i = 0; i < 3; i++) {
      await session.reload();
      assert.equal(plain(finalComponent), expected);
      assert.equal(plain(new AssistantMessageComponent(final as any, true)), expected);
      assert.doesNotMatch(plain(firstComponent), /tokens/);
      assert.doesNotMatch(plain(new AssistantMessageComponent(second as any, true)), /tokens/);
    }
    const finalEntry = session.sessionManager.getBranch().find(entry =>
      entry.type === "message" && entry.message.role === "assistant" && entry.message.timestamp === 1600)!;
    session.sessionManager.appendCompaction("Earlier work summarized", finalEntry.id, 0);
    await session.reload();
    assert.equal(plain(finalComponent), expected);
  } finally {
    await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
  }
});

test("pure replies and stopped/error tasks settle independently and survive reload", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const { session, emit } = await fixture();
  const components: AssistantMessageComponent[] = [];
  try {
    for (const [index, reason] of ["stop", "aborted", "error"].entries()) {
      now = 1000 + index * 5000;
      await emit({ type: "agent_start" });
      await emit({ type: "message_end", message: { role: "user", content: reason, timestamp: now } });
      const final = assistant(`reply ${reason}`, now + 1000, reason, 0.2);
      await emit({ type: "message_end", message: final });
      const component = new AssistantMessageComponent(final as any, true);
      components.push(component);
      assert.doesNotMatch(plain(component), /tokens/);
      now += 2000;
      await emit({ type: "agent_end", messages: [final] });
      await emit({ type: "agent_settled", aborted: reason === "aborted" });
      const rendered = plain(component);
      assert.doesNotMatch(rendered, /turns/);
      assert.match(rendered, /total 2s · 10\.0 tok\/s · \$0\.200 · tokens ↑100 ↓20/);
      assert.doesNotMatch(rendered, /calls|tools |read ×/);
      assert.equal((rendered.match(/tokens/g) ?? []).length, 1);
    }
    const before = components.map(plain);
    await session.reload();
    assert.deepEqual(components.map(plain), before);
  } finally {
    await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
  }
});

test("abort while the last assistant contains tool calls still settles one summary", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const { session, emit } = await fixture();
  try {
    await emit({ type: "message_end", message: { role: "user", content: "write", timestamp: now } });
    await emit({ type: "agent_start" });
    const final = { ...assistant("", 1500, "aborted"), content: [
      { type: "toolCall", id: "aborted-write", name: "write", arguments: { path: "file", content: "partial" } },
    ] };
    await emit({ type: "message_end", message: final });
    now = 2000;
    await emit({ type: "agent_end", messages: [final] });
    await emit({ type: "agent_settled", aborted: true });
    const component = new AssistantMessageComponent(final as any, true);
    const before = plain(component);
    assert.match(before, /write ×1/);
    assert.equal((before.match(/tokens/g) ?? []).length, 1);
    await session.reload();
    assert.equal(plain(component), before);
  } finally {
    await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
  }
});

test("hidden thinking follows stream events and disappears at thinking_end before a tool starts", async () => {
  const { session, emit } = await fixture();
  try {
    setShowThinking(false);
    const message = { ...assistant("", 1000, "toolUse"), content: [
      { type: "thinking", thinking: "first thought" },
    ] };
    const component = new AssistantMessageComponent(undefined, false);
    const update = async (type: string, contentIndex = 0) => {
      await emit({ type: "message_update", message, assistantMessageEvent: { type, contentIndex, partial: message } });
      component.updateContent(message as any, true);
    };
    await update("thinking_delta");
    assert.match(plain(component), /first thought/);
    await update("thinking_end");
    assert.equal(component.render(160).length, 0);
    message.content.push({ type: "text", text: "public text" } as any);
    await update("text_delta", 1);
    assert.match(plain(component), /public text/);
    assert.doesNotMatch(plain(component), /first thought/);
    message.content.push({ type: "thinking", thinking: "" });
    await update("thinking_start", 2);
    assert.doesNotMatch(plain(component), /thought/);
    message.content[2] = { type: "thinking", thinking: "latest thought" };
    await update("thinking_delta", 2);
    assert.match(plain(component), /latest thought/);
    assert.doesNotMatch(plain(component), /first thought/);
    await update("toolcall_start", 3);
    assert.doesNotMatch(plain(component), /thought/);
    await update("thinking_delta", 2);
    await emit({ type: "message_end", message });
    component.updateContent(message as any, false);
    assert.doesNotMatch(plain(component), /thought/);
  } finally {
    await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
  }
});

test("actual prompt queue settles steering and follow-up together, then starts a separate task", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const { session } = await fixture();
  const components: AssistantMessageComponent[] = [];
  let requests = 0;
  let settledCount = 0;
  try {
    await session.modelRuntime.setRuntimeApiKey("openai", "offline-test");
    await session.setModel({
      id: "offline-test", name: "Offline test", provider: "openai", api: "openai-completions",
      baseUrl: "http://localhost.invalid", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000,
    } as any);
    session.agent.streamFunction = (() => {
      const index = ++requests;
      now += 1000;
      const final = assistant(`offline reply ${index}`, now);
      return {
        async *[Symbol.asyncIterator]() {
          if (index === 1) {
            await session.steer("steer this task");
            await session.followUp("follow this task");
          }
          yield { type: "done", reason: "stop", message: final };
        },
        async result() { return final; },
      };
    }) as any;
    session.subscribe(event => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        const component = new AssistantMessageComponent(event.message, true);
        components.push(component);
        assert.doesNotMatch(plain(component), /tokens/);
      }
      if (event.type === "agent_settled") settledCount++;
    });
    await session.prompt("start this task");
    assert.equal(requests, 3);
    assert.equal(settledCount, 1);
    assert.doesNotMatch(plain(components[0]!), /tokens/);
    assert.doesNotMatch(plain(components[1]!), /tokens/);
    const final = plain(components[2]!);
    assert.doesNotMatch(final, /turns/);
    assert.match(final, /\$0\.300 · tokens ↑300 ↓60/);
    await session.reload();
    assert.equal(plain(components[2]!), final);
    await session.prompt("a new independent task");
    assert.equal(settledCount, 2);
    assert.doesNotMatch(plain(components[3]!), /turns/);
    assert.match(plain(components[3]!), /\$0\.100 · tokens ↑100 ↓20/);
    assert.equal(plain(components[2]!), final);
  } finally {
    await (session as any)._extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
  }
});
