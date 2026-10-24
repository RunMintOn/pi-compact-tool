import { getSelectListTheme, getSettingsListTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SelectList, SettingsList, truncateToWidth, type SettingItem } from "@earendil-works/pi-tui";
import { getDisplayPreferences, getDisplayStyle, toolColorNames, type DisplayPreferences, type DisplayStyle } from "./state.ts";

export const displayStyles: DisplayStyle[] = ["aggregate", "tidy", "claude", "off"];

export async function openDisplayMenu(
  ctx: ExtensionContext,
  changeStyle: (style: DisplayStyle) => Promise<void>,
  changePreferences: (patch: Partial<DisplayPreferences>) => Promise<void>,
): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const items: SettingItem[] = [
      { id: "style", label: "展示风格", currentValue: "", description: "aggregate 聚合 · tidy 短摘要 · claude Claude 风格 · off 原生展示" },
      { id: "bashColor", label: "Bash 颜色", currentValue: "", description: "默认 blue（蓝色）。选择 blue 即可恢复默认。" },
      { id: "codemodeColor", label: "Codemode 颜色", currentValue: "", description: "默认 amber（琥珀色）。选择 amber 即可恢复默认。" },
      { id: "codemodeView", label: "Codemode 展示", currentValue: "", description: "compact 单行摘要；calls 摘要加完整原生嵌套调用。" },
      { id: "showThinking", label: "已结束的思考", currentValue: "", description: "隐藏时仍显示当前正在生成的思考，不修改模型设置或消息内容。" },
    ];
    let saving = false;
    const choices = (values: string[]): SettingItem["submenu"] => (current, finish) => {
      const select = new SelectList(values.map(value => ({ value, label: value })), values.length, getSelectListTheme());
      select.setSelectedIndex(Math.max(0, values.indexOf(current)));
      select.onSelect = item => finish(item.value);
      select.onCancel = () => finish();
      return select;
    };
    const sync = () => {
      const preferences = getDisplayPreferences();
      const aggregate = getDisplayStyle() === "aggregate";
      for (const item of items) {
        if (item.id === "style") {
          item.currentValue = getDisplayStyle();
          // A picker avoids applying intermediate styles, especially destructive off.
          item.submenu = choices(displayStyles);
          continue;
        }
        const value = item.id === "showThinking" ? (preferences.showThinking ? "显示" : "隐藏") : preferences[item.id as keyof DisplayPreferences] as string;
        item.currentValue = aggregate ? value : `${value}（仅 aggregate 可用）`;
        item.submenu = !aggregate ? undefined : choices(item.id === "showThinking" ? ["显示", "隐藏"]
          : item.id === "codemodeView" ? ["compact", "calls"] : [...toolColorNames]);
      }
    };
    sync();
    const list = new SettingsList(items, items.length, getSettingsListTheme(), async (id, value) => {
      saving = true;
      tui.requestRender();
      try {
        if (id === "style") await changeStyle(value as DisplayStyle);
        else if (id === "showThinking") await changePreferences({ showThinking: value === "显示" });
        else if (id === "codemodeView") await changePreferences({ codemodeView: value as DisplayPreferences["codemodeView"] });
        else {
          const key = id as "bashColor" | "codemodeColor";
          await changePreferences({ [key]: value });
        }
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
