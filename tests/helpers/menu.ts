import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { stripTerminalSequences, type Component } from "@earendil-works/pi-tui";
import { getDisplayPreferences, getDisplayStyle } from "../../src/state.ts";

const rows = ["style", "bashColor", "codemodeColor", "codemodeView", "showThinking"] as const;
type Row = typeof rows[number];

export function createMenuDriver() {
  let component: Component | undefined;
  let close: (() => void) | undefined;
  const driver = {
    custom(factory: any) {
      return new Promise<void>(resolve => {
        close = () => { component = undefined; resolve(); };
        component = factory({ requestRender() {} }, {
          fg: (_color: string, text: string) => text, bold: (text: string) => text,
        }, {}, close);
      });
    },
    async ready() {
      for (let attempts = 0; !component; attempts++) {
        assert.ok(attempts < 400, "/tools should open a menu");
        await setTimeout(5);
      }
    },
    screen(width = 100) { return component!.render(width).map(stripTerminalSequences).join("\n"); },
    async key(data: string) {
      component!.handleInput!(data);
      for (let attempts = 0; component && driver.screen().includes("正在应用"); attempts++) {
        assert.ok(attempts < 400, "menu update timed out");
        await setTimeout(5);
      }
    },
    async change(open: () => Promise<unknown>, row: Row, value: string) {
      const command = open();
      await driver.ready();
      try {
        for (let i = 0; i < rows.indexOf(row); i++) await driver.key("\x1b[B");
        const current = () => row === "style" ? getDisplayStyle()
          : row === "showThinking" ? (getDisplayPreferences().showThinking ? "显示" : "隐藏")
          : getDisplayPreferences()[row];
        const values = row === "style" ? ["aggregate", "tidy", "claude", "off"]
          : row === "showThinking" ? ["显示", "隐藏"]
          : row === "codemodeView" ? ["compact", "calls"]
          : ["green", "blue", "cyan", "purple", "amber", "orange", "pink", "gray"];
        const delta = values.indexOf(value) - values.indexOf(current() as string);
        await driver.key("\r");
        for (let i = 0; i < Math.abs(delta); i++) await driver.key(delta > 0 ? "\x1b[B" : "\x1b[A");
        await driver.key("\r");
        assert.equal(current(), value);
        assert.ok(component, "changing a value must leave the menu open");
      } finally {
        close!();
        await command;
      }
    },
  };
  return driver;
}
