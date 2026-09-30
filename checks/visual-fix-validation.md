# 紧凑展示视觉修复

## 用户反馈与确认的问题

用户实际截图中，长 Bash 命令截断后，右侧 `lines` 摘要附近出现了终端底色的缺口。同时，正式插件的绿色背景和工具名颜色明显不同于已经认可的 HTML 样稿，工具区域紧贴正文，工具名与目标之间的空间也偏大。

## 底色问题的复现与原因

新增 `tests/background.test.ts`，使用真实 Pi `ToolExecutionComponent` 和 dark 主题，测试短／长 Bash 命令、成功／失败以及 40、80、120 列宽度。逐个字符解释 ANSI 背景状态，要求整行底色一致，覆盖省略号、行数摘要和末尾填充。

复现命令：

```bash
node node_modules/tsx/dist/cli.mjs --test tests/background.test.ts
```

修改前失败：40 列长命令的前 31 个字符有背景，后面 9 个字符没有背景。失败日志保留在 [background-regression-red.log](./background-regression-red.log)。

原因：`truncateToWidth()` 在截断结果里插入 SGR 0 reset。原实现只在整行开头调用一次 `theme.bg()`，所以中间的 reset 清除了后续字符的背景。工具名和摘要的普通前景色关闭序列本身不会清除背景。

修复：统一在工具行与统计行绘制背景；遇到内部 SGR 0、SGR 49 或空 SGR reset，立即重新设置当前区域背景。保留前景色、diff 的局部高亮和原生图片路径。

同一复现命令修改后通过。

## 视觉调整

仅调整 aggregate，tidy / claude 维持原样：

- 深色底色改为样稿的 `#28332b`，不再直接使用主题较亮的成功绿色背景。浅色主题提供对应浅底色，终端仍使用自身 truecolor / 256color 能力。
- 工具名改为样稿的绿／紫配色，避免 system 主题将 Read、Write、Bash 映射为橙、黄、紫等杂色。失败仍使用主题 error 色。
- 工具名最小栏宽从 7 字符缩到 5 字符，更接近 HTML 的文字间距。
- 正文／Think 后的新工具区域保留一行空白。区域内连续工具仍紧贴排列，单次调用之间没有 Think 时不增加空白。
- 对应调整鼠标坐标：保留区域前空白时使用原生坐标，移除行前空白时才做一行偏移。点击空白不会展开工具。

视觉是否最终符合用户偏好仍需用户在自己的终端评价；自动检查不替代该判断。

## 验证结果

- `npm run check`：TypeScript 通过，**30 项测试通过，0 项失败**。
- 新增实际主题底色回归测试通过，包括长命令截断、行数摘要和错误色。
- 更新的区域间距、空白点击和工具标题点击测试通过。
- `npm run test:tui`：真实 fullscreen 启动、串行紧凑排列、parallel 竖线、末尾统计、点击展开／收起、三种风格切换和 reload 全部通过。
- 没有模型请求，没有修改用户的主题或 Pi 配置。没有新增依赖。

保留日志：

- [visual-fix-tests.log](./visual-fix-tests.log)
- [visual-fix-tui-check.log](./visual-fix-tui-check.log)
- [visual-fix-fullscreen.ansi.log](./visual-fix-fullscreen.ansi.log)

## 后续：工具区域留白与 parallel 竖线

根据用户后续截图反馈：

- 整段连续工具区域内部，上下各增加一行同底色留白。工具之间不增加空行；没有 Think 的多个批次仍可以共享一个区域。
- 竖线按完整 parallel 派发组标记，不再依据每条工具的独立重叠状态画出断续线段。全串行组仍不画线，留白行也不画线。
- 新增真实工具组件测试：五条工具共用区域，只有区域两端的两行彩色留白；混合调度记录按组保持竖线连续；顶部、底部留白点击不展开，工具行点击仍正常。
- Fullscreen 检查增加区域上下彩色留白和 parallel 行连续对齐断言。启动及 reload 后均通过。
- 最新 `npm run check`：TypeScript 通过，**31 项测试通过，0 项失败**。`npm run test:tui` 通过。
- 图片继续由原生组件显示，没有新增图片展开／收起或改变显示设置。

最新日志：[padding-tests.log](./padding-tests.log)、[padding-tui-check.log](./padding-tui-check.log)、[padding-fullscreen.ansi.log](./padding-fullscreen.ansi.log)。

原聚合行为与已知历史回放限制见 [aggregate-validation.md](./aggregate-validation.md)。本次没有新增详情弹窗或改变工具执行。
