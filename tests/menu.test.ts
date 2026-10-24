import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { openDisplayMenu } from "../src/menu.ts";
import { defaultPreferences, getDisplayPreferences, getDisplayStyle, resetDisplayState, setDisplayPreferences, setDisplayStyle } from "../src/state.ts";
import { createMenuDriver } from "./helpers/menu.ts";

test("menu opens without changes, disables aggregate-only settings live, and exits with Escape", async () => {
  initTheme("dark", false);
  resetDisplayState("aggregate");
  const menu = createMenuDriver();
  let writes = 0;
  let closed = false;
  const opened = openDisplayMenu({ ui: { custom: menu.custom } } as any, async style => {
    setDisplayStyle(style);
  }, async patch => {
    writes++;
    setDisplayPreferences({ ...getDisplayPreferences(), ...patch });
  }).then(() => { closed = true; });
  assert.equal(getDisplayStyle(), "aggregate");
  assert.equal(writes, 0);
  assert.match(menu.screen(), /风格：当前进程保留.*其他偏好：全局保存/);
  assert.match(menu.screen(), /Bash 颜色\s+blue/);
  assert.match(menu.screen(), /已结束的思考\s+显示/);

  await menu.key("\r");
  await menu.key("\x1b[B");
  assert.equal(getDisplayStyle(), "aggregate", "browsing choices must not apply them");
  await menu.key("\x1b");
  assert.equal(getDisplayStyle(), "aggregate", "Escape must discard the unconfirmed choice");
  await menu.key("\r");
  await menu.key("\x1b[B");
  await menu.key("\r");
  assert.equal(getDisplayStyle(), "tidy");
  assert.equal(closed, false);
  assert.equal(menu.screen().match(/仅 aggregate 可用/g)?.length, 4);
  for (let i = 0; i < 4; i++) {
    await menu.key("\x1b[B");
    await menu.key("\r");
    await menu.key(" ");
  }
  assert.equal(writes, 0);
  assert.deepEqual(getDisplayPreferences(), defaultPreferences);
  for (let i = 0; i < 4; i++) await menu.key("\x1b[A");
  await menu.key("\r");
  await menu.key("\x1b[A");
  await menu.key("\r");
  assert.equal(getDisplayStyle(), "aggregate");
  assert.doesNotMatch(menu.screen(), /仅 aggregate 可用/);
  await menu.key("\x1b[B");
  await menu.key("\r");
  await menu.key("\x1b[B");
  await menu.key("\r");
  assert.equal(getDisplayPreferences().bashColor, "cyan");
  assert.equal(writes, 1);
  for (const width of [20, 40, 100]) {
    assert.ok(menu.screen(width).split("\n").every(line => visibleWidth(line) <= width));
  }
  await menu.key("\x1b");
  await opened;
  assert.equal(closed, true);
});
