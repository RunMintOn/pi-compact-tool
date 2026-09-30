# Parallel 标题与普通统计文字验证

## 本次范围

- aggregate 工具名与正文左对齐，移除左侧竖线及额外预留空间。保留原生 `outputPad`：默认 1 列，可设为 0。工具、parallel 标题与统计均遵循正文缩进。
- parallel 组首显示低饱和蓝灰色 `parallel · N calls` 标题，计数使用 muted 颜色。
- 标题前一行同底色空白，标题紧贴组内工具；parallel 后接普通工具时也保留一行空白。相邻 parallel 组仅间隔一行。
- 工具区域保持连续底色，首尾复用已有留白，不叠加。普通串行工具紧贴排列。
- 末尾统计移除背景、额外缩进和渲染器追加的空白行，保留原生缩进。统计内容与位置不变。
- 工具执行、parallel 判断与持久化语义不变。图片仍走原生显示，不处理图片折叠。

## 已执行检查

```bash
npm run check
npm run test:tui
```

- TypeScript 检查通过。
- 34 项测试通过，0 项失败，包含默认 1 列及显式 0 列缩进检查。
- 实际 ToolExecutionComponent 验证普通调用 → parallel → 相邻 parallel → 普通调用的行序、边界和连续底色。
- 留白与标题点击不展开工具；标题下面的工具行点击仍展开。原生 Think、图片协议、风格切换和 patch 恢复测试通过。
- 窄宽度、长 Bash 命令、行数、失败显示和 ANSI reset 背景回归测试通过。
- 历史串行调度恢复后，不出现 parallel 标题或内部组间留白。
- 真实 Pi fullscreen 历史回放检查通过：左对齐工具和标题、首尾同底色留白、隐藏错误正文、回答后无背景统计、点击展开／收起、三种风格切换及 reload。

先修改布局预期测试，运行旧实现时 4 项失败；实施后上述检查全部通过。

## 可检查结果

本次详细日志保存在 worktree 外：

- `/tmp/pi-compact-layout-red.log`
- `/tmp/pi-compact-layout-check.log`
- `/tmp/pi-compact-layout-tui.log`
- `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-tui-results-L296fH/fullscreen.ansi.log`

## 原生缩进修正后的复检

首次调整误去除了原生 1 列缩进。用户反馈后恢复，并遵循 Pi 的 `outputPad` 设置。再次运行 `npm run check` 与 `npm run test:tui`，全部通过。真实屏幕断言检查工具、标题和统计均保留 1 列缩进。

最新日志：

- `/tmp/pi-compact-padding-check.log`
- `/tmp/pi-compact-padding-tui.log`
- `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-tui-results-1OdEmC/fullscreen.ansi.log`

## Bash 失败摘要与图片分段修正

- Bash 失败时工具名和命令仍为红色，行数及摘要保持 muted 浅灰色。
- 图片保持原生所属工具位置和协议。文本面板在图片前增加同底色底部留白；图片后还有同区域工具时恢复顶部留白。下一段已有分组留白时不重复添加，末尾图片后不生成孤立色条。
- 实际工具组件测试覆盖图片前后留白、标题行点击、空白行不展开、图片隐藏、区域末尾图片和分组边界图片。
- `npm run check` 通过：TypeScript 和 35 项测试，0 项失败。
- `npm run test:tui` 通过，仍为关闭图片像素的真实 PTY 检查。图片边界验证来自启用 iTerm2 图片协议的实际组件测试，不是终端图片像素截图。

日志：

- `/tmp/pi-compact-image-red.log`（修改前两项预期失败）
- `/tmp/pi-compact-image-check.log`
- `/tmp/pi-compact-image-tui.log`
- `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-tui-results-jwwJm6/fullscreen.ansi.log`

## 验证边界

真实 fullscreen 使用本地工具产生的历史记录，无模型请求。PTY 文本检查关闭图片像素显示；图片数据和协议由组件测试覆盖。没有验证终端图片像素，也尚未获得用户对新布局的视觉反馈。未修改用户配置、未安装、未提交 commit。
