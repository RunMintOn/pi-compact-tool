# pi-compact-tool（项目三）

[English](./README.md)

在 Pi TUI 中快速切换三套工具展示。样式参考 `pi-tidy-tools`（项目一）和 [`pi-tool-display-intent`](https://github.com/zhcsyncer/pi-extensions/tree/main/packages/pi-tool-display-intent)（参考二），本项目独立实现，不加载这两个扩展。

- **aggregate**（默认）：工具区域中的 Think 与单行工具记录共用连续底色，左对齐的弱强调标题区分 parallel 调用组，Think 保留原位置及原生展开交互；最终回答后显示本次请求的分类计数、耗时、token 和日期时间。
- **tidy**：项目一的短摘要风格。Bash 显示首行输出及剩余行数，Edit 显示修改统计，Write 显示完成状态。
- **claude**：`● Read(path)`、`● Bash(command)` 和缩进结果摘要。
- Fullscreen 左键点击工具标题或文字结果，只展开／收起这一条。
- 三套风格共享展开状态。切换不重新执行工具，也不需要 `/reload`。
- Edit 展开使用 Pi 官方 diff；Write 展开显示新内容。没有自定义左右 diff、执行前预览或旧文件预读取。
- 图片继续由 Pi 原生图片层显示，不随文字展开／收起。
- aggregate 的 Bash 成功、失败均显示文字结果行数；无输出显示 `0 lines`。失败时工具名和目标变红，行数等摘要保持浅灰色，收起时不显示错误正文，展开查看完整错误。tidy / claude 保持原错误摘要。

## 试用

需要 Pi **0.99.1 或更新的 0.x 版本**。

在项目目录执行：

```bash
pi -ne -e ./index.ts --tui-mode fullscreen
```

`-ne` 禁用自动加载的扩展，只加载这个显式指定的扩展，适合首次试用。若需要其他扩展，通过额外的 `-e` 指定。

不要同时加载项目一、参考二或其他接管同名内置工具的显示扩展。这里覆盖 `read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`，不会因此自动启用原本未启用的工具。

执行直接委托 Pi 官方实现。参数 schema、提示词和官方元数据保留，取消信号、流式回调、完整执行上下文原样转发。使用 Pi 合并后的 shell 和图片设置。不增加 `displaySummary`，不增加模型请求，不修改返回结果。

## 风格切换

```text
/tool-style          依次切换 aggregate → tidy → claude
/tool-style aggregate 紧凑工具记录与回答末尾统计
/tool-style tidy     项目一短摘要风格
/tool-style claude   项目三 Claude 风格
```

已有工具行立即刷新，并保留每条的展开状态。新会话和 reload 回到启动风格；本版不持久化风格选择。

指定启动风格：

```bash
pi -ne -e ./index.ts --tui-mode fullscreen --compact-style tidy
```

`/compact` 是 Pi 的上下文压缩命令，本项目不占用它。`Ctrl+O` 仍是 Pi 的全局展开操作，本项目的主要交互是 fullscreen 单条点击。普通终端滚动模式不提供同样的点击交互。

## 分组与统计

- Think 不决定分组。同一条 assistant 消息内的多工具调用构成候选 parallel 组。连续的单次调用即使中间没有 Think，也不添加标题；它们仍紧贴排列。
- 新调用观察 `tool_execution_start/end`：同组出现活动区间重叠时，为整个 parallel 调用组显示标题；全组实际串行时不显示。标题表示整组派发，不表示每条工具的独立重叠区间。这里观察的是 Pi 的工具调度事件，不是操作系统进程的 CPU 执行时间。
- 旧 transcript 没有执行事件时，按同一条 assistant 消息中的多调用恢复 parallel 标题，只代表同批派发，不能证明真实时间重叠。
- 新调用的调度标记、Bash 输出行数和请求起止时间保存为非模型上下文的 custom entry，供 reload / 历史回放使用，不改变工具结果或模型消息。
- 分类计数包含失败调用。`turns` 统计本次请求的 assistant 消息数，包含最终回答；不等于用户消息数。Think 继续使用原生内容与点击展开／收起，仅在所在连续区域含工具调用时融入背景；独立 Think 保持原生外观；普通正文和旁白保持无背景，并打断区域。parallel 标题只出现在对应工具组前面。
- 统计覆盖用户消息之后、最终回答之前的本次请求，显示在最终回答后。耗时是这次请求的墙钟时间，不是工具耗时求和；旧记录没有精确时间时，使用消息时间戳估算。尚未完成的请求不显示最终统计。统计前保留一行空白，使用普通文字，无面板背景；`Tools` 不加粗，保留正文原生缩进。
- Bash 行数优先统计官方提供的输出数据，不把 `(no output)` 和退出状态说明算成命令输出。忽略末尾换行，不计算终端自动折行。输出已被官方工具截断时显示 `truncated`，使用其输出行数元数据，不读取完整输出文件。旧记录没有保存行数时，回退为收到的文字结果行数；可能包含原生状态说明。
- aggregate 使用样稿的低对比度底色和绿／紫工具名配色，按主题的深浅模式和终端颜色能力显示。工具区域中的 Think 前保留一行同底色空白，后面紧贴工具；区域开头复用顶部留白，共用一个连续区域；区域与普通正文之间保留一行，色块内部上下各有一行留白，所有工具名与正文左对齐，遵循原生 `outputPad`（默认 1 列，可设为 0），不保留竖线或额外左侧标记空间。parallel 组前显示低饱和蓝灰色的 `parallel · N calls` 标题，标题紧贴下面的工具。组前及组后接普通工具时，各保留一行同底色空白；相邻 parallel 组之间只有一行空白。区域首尾复用已有留白，不叠加。普通串行工具仍紧贴排列，整段背景不按组拆分。截断或高亮产生的 ANSI reset 后恢复区域底色，避免摘要出现黑底缺口。
- aggregate 通过可撤销的原生工具 `render/handleMouse` 和 assistant `render` patch 去掉区域内部的逐条空白、追加末尾统计。只在 TUI 会话安装，reload / shutdown 恢复，只装饰 Think 背景和布局，点击转发给原生 MouseRegion；不修改 Think 内容、折叠状态、图片协议或工具执行逻辑。

## 图片

保留 Pi 的图片协议、显示开关和转换行为。文字收起时图片仍可能显示；这和 Pi 原生行为一致。图片像素是否能显示，取决于终端支持和 Pi 的图片设置。aggregate 中图片仍位于所属工具后面：图片前补一行同底色底部留白，图片后还有同区域工具时补一行顶部留白；复用已有分段留白，不重复添加。没有将图片集中移到工具区域末尾。

## 自定义工具

`ffgrep`、`fffind`、`codemode` 在 TUI 中自动接入，无需修改它们的插件或注册代码。适配集中在 `src/custom-tools.ts`，只替换显示组件使用的工具定义，不修改工具注册表、执行函数、schema、exposure 或激活状态；shutdown / reload 恢复原 renderer。

- `ffgrep` 收起显示 pattern、path 和 `totalMatched` 匹配数；`fffind` 使用文件数。旧结果缺少元数据时显示结果行数，展开查看完整输出。
- `codemode` 收起显示代码首行和内部调用数；无内部调用时显示脚本输出行数，不计原生状态头。展开保留原生完整脚本、内部调用状态与输出。统计仍只计顶层 codemode 调用，内部调用不冒充独立 parallel 组。
- 不自动启用这些工具。其他未接入工具保持原 renderer。

其他自定义工具需要接管展示时，在原有 `pi.registerTool()` 处包装工具定义：

```ts
import { decorateTool } from "pi-compact-tool/display";

pi.registerTool(decorateTool(existingTool));
```

直接使用本地源码时，把 import 换成实际的 `src/display.ts` 路径。

默认使用通用调用摘要和文本结果。需要专门样式时，提供显示 adapter。例如接入另一个搜索工具：

```ts
pi.registerTool(decorateTool(existingSearchTool, {
  kind: "search",
  target: (args) => `${args.pattern ?? ""} in ${args.path ?? "."}`,
  summary: (result) => {
    const text = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.type === "text" ? block.text : "")
      .join("\n");
    return `${text.split("\n").filter(Boolean).length} result lines`;
  },
}));
```

支持 `generic`、`read`、`search`、`bash`、`edit`、`write` 六种 kind。只有选择 `edit` 且结果已有 `details.diff` 时，才显示官方 diff。工具执行函数、参数和模型可见信息保持原定义；adapter 只格式化已提供的数据，不应读取文件或执行工具。接入会替换该工具原有的 renderer，不保留原 renderer 的特殊按钮或交互。

本版没有整组 Run 折叠、独立详情弹窗、额外意图字段、项目一的工具类别快捷键或 Markdown 自动展开模式。点击使用原生单条展开／收起；未接入的自定义工具仍保留自身显示和间距。

## 本地验证

```bash
npm install --ignore-scripts --legacy-peer-deps
npm run check
npm run test:tui  # 需要 expect、python3 和 pi
```

开发环境需让本项目能解析 Pi 宿主包和 `typebox`。本机验证使用已有 Pi 安装的软链接，未另外安装一份 Pi。

当前布局细调、自定义工具接入、42 项测试与真实 fullscreen 检查见 [本轮验证记录](./checks/polish-validation.md)。此前 Think 融合见 [Think 验证记录](./checks/thinking-validation.md)。此前左对齐与分组标题见 [布局验证记录](./checks/parallel-heading-validation.md)。此前底色与留白修复见 [视觉修复记录](./checks/visual-fix-validation.md)。第一版聚合实现保留在 [聚合验证记录](./checks/aggregate-validation.md)。原逐条版本的验证保留在 [历史验证记录](./checks/project-3-validation.md)。MIT 许可证见 [LICENSE](./LICENSE)。
