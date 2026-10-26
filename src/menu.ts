import { getSelectListTheme, getSettingsListTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SelectList, SettingsList, truncateToWidth, type SettingItem } from "@earendil-works/pi-tui";
import { getDisplayPreferences, getDisplayStyle, toolColorNames, type DisplayPreferences, type DisplayStyle } from "./state.ts";

export const displayStyles: DisplayStyle[] = ["aggregate", "tidy", "claude", "off"];

/**
 * One row of the display menu. Declaring the options, how to read the current
 * value and how to save a new one together keeps the id from being switched on
 * twice (once to render, once to save) and keeps the row order in one place.
 */
interface MenuRow {
  id: string;
  label: string;
  description: string;
  options: string[];
  aggregateOnly: boolean;
  current: () => string;
  save: (value: string) => Promise<void>;
}

export async function openDisplayMenu(
  ctx: ExtensionContext,
  changeStyle: (style: DisplayStyle) => Promise<void>,
  changePreferences: (patch: Partial<DisplayPreferences>) => Promise<void>,
): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const colorOptions = [...toolColorNames];
    const rows: MenuRow[] = [
      {
        id: "style", label: "展示风格", aggregateOnly: false,
        description: "aggregate 聚合 · tidy 短摘要 · claude Claude 风格 · off 原生展示",
        options: displayStyles,
        current: () => getDisplayStyle(),
        save: style => changeStyle(style as DisplayStyle),
      },
      {
        id: "bashColor", label: "Bash 颜色", aggregateOnly: true, options: colorOptions,
        description: "默认 blue（蓝色）。选择 blue 即可恢复默认。",
        current: () => getDisplayPreferences().bashColor,
        save: value => changePreferences({ bashColor: value as DisplayPreferences["bashColor"] }),
      },
      {
        id: "codemodeColor", label: "Codemode 颜色", aggregateOnly: true, options: colorOptions,
        description: "默认 amber（琥珀色）。选择 amber 即可恢复默认。",
        current: () => getDisplayPreferences().codemodeColor,
        save: value => changePreferences({ codemodeColor: value as DisplayPreferences["codemodeColor"] }),
      },
      {
        id: "codemodeView", label: "Codemode 展示", aggregateOnly: true, options: ["compact", "calls"],
        description: "compact 单行摘要；calls 摘要加完整原生嵌套调用。",
        current: () => getDisplayPreferences().codemodeView,
        save: value => changePreferences({ codemodeView: value as DisplayPreferences["codemodeView"] }),
      },
      {
        id: "showThinking", label: "已结束的思考", aggregateOnly: true, options: ["显示", "隐藏"],
        description: "隐藏时仍显示当前正在生成的思考，不修改模型设置或消息内容。",
        current: () => (getDisplayPreferences().showThinking ? "显示" : "隐藏"),
        save: value => changePreferences({ showThinking: value === "显示" }),
      },
    ];
    const items: SettingItem[] = rows.map(row => ({
      id: row.id, label: row.label, currentValue: "", description: row.description,
    }));
    let saving = false;
    const choices = (values: string[]): SettingItem["submenu"] => (current, finish) => {
      const select = new SelectList(values.map(value => ({ value, label: value })), values.length, getSelectListTheme());
      select.setSelectedIndex(Math.max(0, values.indexOf(current)));
      select.onSelect = item => finish(item.value);
      select.onCancel = () => finish();
      return select;
    };
    const sync = () => {
      const aggregate = getDisplayStyle() === "aggregate";
      rows.forEach((row, index) => {
        const item = items[index]!;
        const value = row.current();
        item.currentValue = row.aggregateOnly && !aggregate ? `${value}（仅 aggregate 可用）` : value;
        // SettingsList has no disabled state, so an aggregate-only row is marked
        // in its value text and simply has no picker to open.
        item.submenu = row.aggregateOnly && !aggregate ? undefined : choices(row.options);
      });
    };
    sync();
    const list = new SettingsList(items, items.length, getSettingsListTheme(), async (id, value) => {
      const row = rows.find(candidate => candidate.id === id);
      if (!row) return;
      saving = true;
      tui.requestRender();
      try {
        await row.save(value);
      } finally {
        saving = false;
        sync();
        tui.requestRender();
      }
    }, () => done());
    return {
      render(width: number): string[] {
        return [
          theme.fg("accent", theme.bold("工具展示")),
          theme.fg("dim", "风格：当前进程保留 · 其他偏好：全局保存"),
          theme.fg("dim", saving ? "正在应用…" : "↑↓ 选择 · Enter 修改/确认 · Esc 返回/退出"),
          "",
          ...list.render(width),
        ].map(line => truncateToWidth(line, width));
      },
      invalidate() { list.invalidate(); },
      handleInput(data: string) {
        if (!saving) list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
