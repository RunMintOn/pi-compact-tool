# pi-compact-tool（项目三）

[English](./README.md)

在 Pi TUI 中快速切换三套工具展示。样式参考 `pi-tidy-tools`（项目一）和 [`pi-tool-display-intent`](https://github.com/zhcsyncer/pi-extensions/tree/main/packages/pi-tool-display-intent)（参考二），本项目独立实现，不加载这两个扩展。

- **aggregate**（默认）：工具区域中的 Think 与单行工具记录共用连续底色，左对齐的弱强调标题区分 parallel 调用组，Think 保留原位置及原生展开交互；最终回答后显示本次请求的分类计数、耗时、token 和日期时间。
- **tidy**：项目一的短摘要风格。Bash 显示首行输出及剩余行数，Edit 显示修改统计，Write 显示完成状态。
- **claude**：`● Read(path)`、`● Bash(command)` 和缩进结果摘要。
- Fullscreen 左键点击工具标题或文字结果，只展开／收起这一条。
- 三套风格共享展开状态。切换不重新执行工具，也不需要 `/reload`。
- 工具行展开仍使用原生内容：Edit 显示 Pi 官方 diff，Write 显示写入内容。另有 `View changes` 打开整轮净 diff 页面，支持文件导航、单／双栏和长行折行。
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

## aggregate 展示偏好

```text
/codemode-view          切换 A / B
/codemode-view compact  A：codemode 收起时只显示一行（默认）
/codemode-view calls    B：摘要下完整显示原生嵌套调用区域
/tool-thinking         切换 thinking 显示／隐藏
/tool-thinking show    显示 thinking（默认，沿用原生展开状态）
/tool-thinking hide    隐藏全部 thinking，包括独立与运行中的 thinking
```

两项设置独立，仅影响 aggregate。切换立即刷新已有记录，不改变单条工具的展开状态。B 不显示脚本及输出正文；调用列表保留原生展开时的参数、换行、状态、耗时、错误与费用信息，全部调用显示，并实时更新运行状态。无嵌套调用时 A / B 都保持单行。点击摘要或任意调用行展开整个 codemode，再次收起时恢复所选 A / B；`Ctrl+O` 保持原生全局展开操作。

隐藏 thinking 不修改模型思考设置或消息内容，不显示 `Thinking...` 占位，也不留下空行。串行工具连续排列；parallel 组保留分组间距。重新显示时保留 thinking 原有展开状态，普通正文、错误及最终统计不受影响。tidy / claude 保持原生 thinking 展示。

命令自动保存到 `getAgentDir()/extension-data/pi-compact-tool/preferences.json`，通常为 `~/.pi/agent/extension-data/pi-compact-tool/preferences.json`。所有项目共用，跨新会话和 reload 恢复；首次默认 A + thinking 显示。`/tool-style` 仍不持久化。保存失败时报告错误，不改变当前偏好。

## 查看本轮修改

在 TUI 会话里，Edit / Write 第一次真正写入某个文件前保存起点快照。整轮任务完全结束后，只读取这些文件的最终内容，生成独立 HTML 页面。同一文件多次编辑合并成一份净 diff；恢复原样的文件不计入净修改。不扫描仓库，不使用 Git HEAD 作为基准。路径解析、编辑规则和文件写入队列仍由官方工具处理；快照通过官方文件操作接口记录，不改变工具结果或模型上下文。

aggregate 统计第一行在工具枚举后显示 **View changes**。宽度不足时先省略左侧统计，保留链接；极窄时链接缩短为 **Changes**。第二行日期规则不变。链接打开方式取决于终端的 OSC 8 支持，普通模式可能需要 Ctrl／Command 点击。所有展示风格都可以使用：

```text
/changes             打开当前会话最近生成的修改页面
```

命令会等待正在执行的任务完全结束，再用系统浏览器打开页面。打开失败时显示页面的文件链接。

页面包含可折叠的完整 **User message** 文本，以及同一轮内观察到的追加用户消息、起止时间、完成／中止／错误状态、净修改文件数和增删行数。左侧文件目录显示 Added / Modified / Deleted / Unavailable，并随阅读位置高亮当前文件。**Auto** 按 diff 区域宽度自动选择布局：至少 900 px 时双栏，否则单栏；**Split** 和 **Unified** 手动指定布局。切换布局保留当前文件位置。**Wrap lines** 让长行折行。窄窗口通过 **Files** 打开文件目录。页面自动跟随系统／浏览器明暗主题。

范围是**本插件 Edit / Write 涉及的文件**，包含通过这些工具定义执行的嵌套调用。仅由 Bash 或其他工具修改的文件不记录；已记录文件的终点可能包含后续格式化、外部编辑或删除。中止／错误后已经发生的修改仍可查看。二进制或无效 UTF-8 文件、读取失败、超过 1 MiB 的文件标为 Unavailable，不误显示为新增文件；整轮起点快照预算为 16 MiB。无法比较的文件不计入已知增删行数。

页面保存在 `getAgentDir()/extension-data/pi-compact-tool/changes/`，通常为 `~/.pi/agent/extension-data/pi-compact-tool/changes/`。diff2html 的脚本和样式内嵌，不需要服务器或联网。仅保存 HTML，结算后释放源文件快照。链接关联和最近页面路径只保存在当前会话／运行的内存中；reload 或切换会话后不恢复。已有 HTML 仍可手动打开，不自动清理。功能加载前的轮次无法补造完整 diff。如果所有文件恢复原样，第一行显示 **No net changes**，不生成新页面。

## 分组与统计

- Think 不决定分组。同一条 assistant 消息内的多工具调用构成候选 parallel 组。连续的单次调用即使中间没有 Think，也不添加标题；它们仍紧贴排列。
- 新调用观察 `tool_execution_start/end`：同组出现活动区间重叠时，为整个 parallel 调用组显示标题；全组实际串行时不显示。标题表示整组派发，不表示每条工具的独立重叠区间。这里观察的是 Pi 的工具调度事件，不是操作系统进程的 CPU 执行时间。
- 旧 transcript 没有执行事件时，按同一条 assistant 消息中的多调用恢复 parallel 标题，只代表同批派发，不能证明真实时间重叠。
- 新调用的调度标记、Bash 输出行数和请求起止时间保存为非模型上下文的 custom entry，供 reload / 历史回放使用，不改变工具结果或模型消息。
- 分类计数包含失败调用。`turns` 统计本次请求的 assistant 消息数，包含最终回答；不等于用户消息数。Think 继续使用原生内容与点击展开／收起，仅在所在连续区域含工具调用时融入背景；独立 Think 保持原生外观；普通正文和旁白保持无背景，并打断区域。parallel 标题只出现在对应工具组前面。
- 统计覆盖用户消息之后、最终回答之前的本次请求，显示在最终回答后。耗时是这次请求的墙钟时间，不是工具耗时求和；旧记录没有精确时间时，使用消息时间戳估算。尚未完成的请求不显示最终统计。统计前保留一行空白，使用普通文字，无面板背景；首行直接从调用数开始，不显示 `Tools` 标签，保留正文原生缩进。
- 时间显示为 `total 2m 10s (tools 1m 40s) · TPS 30.0 tok/s`。`tools` 是本次用户请求内所有顶层工具执行时间段的并集，并行重叠只算一次，嵌套调用已包含在父工具时间内，不重复计算。时间包括 Pi 的准备、确认和结果处理，不仅是 Bash 进程时间。工具计时缺失或无效时不显示工具耗时，不估算。
- TPS 累计本次 `agent_end.messages` 中 assistant 的 `usage.output`，除以 `agent_start` 到 `agent_end` 的总秒数减去该次运行的工具时间段并集；工具时间段裁剪到该次运行的起止范围。仍包含工具阶段以外的网络等待和思考，不拆分 reasoning token。TPS 按该次 agent 运行计算，工具耗时及其他计数按用户请求累计，包含续跑。新 TPS 连同公式标记保存到已有 custom entry，reload 后恢复；旧记录可从完整工具计时恢复工具耗时，但不显示旧口径 TPS。无有效起点、工具计时、剩余耗时或输出时不显示 TPS。仅在 aggregate 已有统计中加入，不新增纯回答统计或通知；停用独立 `tps.ts`，避免重复通知。
- 费用显示为 `$0.641`，保留三位小数。从当前用户消息到这次回答结束，累加其间所有 assistant 消息的 `usage.cost.total`，包含中间多次模型调用，不累计之前消息的费用。金额使用 Pi 已记录的美元费用估算，不额外查询账单或自行计算价格；每条新用户消息重新计费。reload 从消息 usage 恢复，旧记录缺少费用数据时不显示金额。
- Bash 行数优先统计官方提供的输出数据，不把 `(no output)` 和退出状态说明算成命令输出。忽略末尾换行，不计算终端自动折行。输出已被官方工具截断时显示 `truncated`，使用其输出行数元数据，不读取完整输出文件。旧记录没有保存行数时，回退为收到的文字结果行数；可能包含原生状态说明。
- aggregate 使用样稿的低对比度底色和绿／紫工具名配色，按主题的深浅模式和终端颜色能力显示。工具区域中的 Think 前保留一行同底色空白，后面紧贴工具；区域开头复用顶部留白，共用一个连续区域；区域与普通正文之间保留一行，色块内部上下各有一行留白，所有工具名与正文左对齐，遵循原生 `outputPad`（默认 1 列，可设为 0），不保留竖线或额外左侧标记空间。parallel 组前显示低饱和蓝灰色的 `parallel · N calls` 标题，标题紧贴下面的工具。组前及组后接普通工具时，各保留一行同底色空白；相邻 parallel 组之间只有一行空白。区域首尾复用已有留白，不叠加。普通串行工具仍紧贴排列，整段背景不按组拆分。截断或高亮产生的 ANSI reset 后恢复区域底色，避免摘要出现黑底缺口。
- aggregate 通过可撤销的原生工具 `render/handleMouse` 和 assistant `render` patch 去掉区域内部的逐条空白、追加末尾统计。只在 TUI 会话安装，reload / shutdown 恢复，装饰 Think 背景和布局，并可隐藏其显示，点击转发给原生 MouseRegion；不修改 Think 内容、折叠状态、图片协议或工具执行逻辑。

## 图片

保留 Pi 的图片协议、显示开关和转换行为。文字收起时图片仍可能显示；这和 Pi 原生行为一致。图片像素是否能显示，取决于终端支持和 Pi 的图片设置。aggregate 中图片仍位于所属工具后面：图片前补一行同底色底部留白，图片后还有同区域工具时补一行顶部留白；复用已有分段留白，不重复添加。没有将图片集中移到工具区域末尾。

针对多图滚动增加了 aggregate 文字排版缓存和隐藏 thinking 的区域节点缓存，避免每帧重复截断、着色及过滤。没有修改图片协议、转换、上传或原生缓存。300 张 PNG 的本地 fullscreen CPU 对照及限制见 [展示与性能验证](./checks/display-preferences-validation.md)；测量不包含真实终端的图片解码和绘制，不能据此认定所有滑动卡顿已消除。

## 自定义工具

`ffgrep`、`fffind`、`codemode` 在 TUI 中自动接入，无需修改它们的插件或注册代码。适配集中在 `src/custom-tools.ts`，只替换显示组件使用的工具定义，不修改工具注册表、执行函数、schema、exposure 或激活状态；shutdown / reload 恢复原 renderer。

- `ffgrep` 收起显示 pattern、path 和 `totalMatched` 匹配数；`fffind` 使用文件数。旧结果缺少元数据时显示结果行数，展开查看完整输出。
- `codemode` 默认收起显示代码首行和内部调用数；aggregate 的 B 模式另显示完整原生内部调用区域。无内部调用时显示脚本输出行数，不计原生状态头。展开保留原生完整脚本、内部调用状态与输出。统计仍只计顶层 codemode 调用，内部调用不冒充独立 parallel 组。
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
npm run test:display-tui  # 验证 A/B、点击、thinking 显隐及偏好恢复
npm run test:changes-ui  # 需要 ego-browser，HTML、结果和截图保存在 worktree 外
```

开发环境需让本项目能解析 Pi 宿主包和 `typebox`。本机验证使用已有 Pi 安装的软链接，未另外安装一份 Pi。

本次展示偏好及多图性能检查见 [展示与性能验证](./checks/display-preferences-validation.md)。本轮净 diff 测试和浏览器检查见 [修改查看验证](./checks/changes-validation.md)。当前布局细调、自定义工具接入、42 项测试与真实 fullscreen 检查见 [本轮验证记录](./checks/polish-validation.md)。此前 Think 融合见 [Think 验证记录](./checks/thinking-validation.md)。此前左对齐与分组标题见 [布局验证记录](./checks/parallel-heading-validation.md)。此前底色与留白修复见 [视觉修复记录](./checks/visual-fix-validation.md)。第一版聚合实现保留在 [聚合验证记录](./checks/aggregate-validation.md)。原逐条版本的验证保留在 [历史验证记录](./checks/project-3-validation.md)。MIT 许可证见 [LICENSE](./LICENSE)。
