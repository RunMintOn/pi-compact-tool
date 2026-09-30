# 统计、Think 留白与自定义工具接入验证

## 本轮行为

- 回答与末尾统计之间增加一行无背景空白。`Tools` 不加粗，使用 muted 颜色；计数、内容和原生 outputPad 不变。
- Think 仅在所属连续区域确实含工具调用时使用面板背景。独立 Think → 回答保持原生无背景外观与点击交互。
- 工具区域中，Think 前增加一行同底色空白，后面紧贴工具。区域开头复用已有顶部留白。图片后接 Think 时复用这一行，不叠加。
- 流式 Think 在尚未确定工具调用时保持原生外观；工具调用确定或消息完成进入投影后再按区域决定背景。不修改模型消息或请求统计。

## 自动适配

适配集中在 `src/custom-tools.ts`，由可撤销的 TUI patch 接入。仅替换 ToolExecutionComponent 自己使用的定义，不重新 registerTool，不改注册表、execute、schema、exposure、annotations 或激活状态，不依赖这些扩展的加载先后顺序。

- `ffgrep`、`fffind`：pattern、path、匹配／文件总数；缺少 `totalMatched` 的旧结果使用结果行数。展开保留完整输出。
- `codemode`：代码首行和内部调用数；没有内部调用时统计脚本输出行数，排除原生状态头。展开直接使用原生 call/result renderer，保留完整脚本、内部调用状态和输出。
- 不启用任何工具。未适配工具保持原 renderer。release 恢复组件的原始定义和 framing，并重建 renderer 缓存。
- 顶层统计仍将 codemode 视为一次工具调用，内部调用不插入 transcript 或 parallel 分组。

FFF 参数及 `details.totalMatched` 形状依据本地 `../fff-pi-work/pi-fff/packages/pi-fff/src/index.ts`。Code mode renderer 依据本机 Pi 0.99.1 的实际实现。

## 实际执行

```bash
npm run check
npm run test:tui
```

- TypeScript 通过。
- 42 项测试通过，0 项失败。
- 5 项布局预期在修改前确认失败后修正，日志见 red 文件。
- 实际 Think 组件覆盖独立 Think、混合 Think/正文、工具区域间距、留白点击、各段独立展开、流式行为和风格切换。
- 实际 FFF 形状 fixture 与 ToolExecutionComponent 覆盖收起、展开、窄屏、未知工具不接管，以及 release 恢复。
- 实际 Pi SDK 加载未包装的 FFF fixture；检查适配、元数据和注册 renderer/execute 引用不变、激活工具集合不变、reload 后再次适配。
- 使用本机实际 createCodemodeToolDefinition 验证一行收起、原生展开的脚本/调用状态/输出、状态头不计行数，以及 release 后恢复原 renderer。
- 真实 fullscreen 回放检查统计前空行、Tools 不加粗、Think 前同底色留白、Think 和工具点击、风格切换及 reload。

详细结果在 worktree 外：

- `/tmp/pi-compact-polish-red.log`
- `/tmp/pi-compact-polish-check.log`
- `/tmp/pi-compact-polish-tui.log`
- `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-tui-results-Ia8sF8/fullscreen.ansi.log`

## 验证边界

无模型请求。FFF 搜索执行使用 fixture，没有运行真实 FFF 索引引擎；Code mode 验证实际原生 renderer，没有执行 QuickJS 脚本。流式 Think 使用实际组件测试，没有模型驱动流式 E2E。PTY 关闭图片像素显示，既有图片协议与间距组件测试通过。未改相邻 FFF 项目或用户配置，未提交本轮 commit 或 push。
