# 项目三验证记录

## 已实现

- 根目录 `index.ts` 是 Pi 扩展入口。生产代码共 361 行，位于入口及 `src/`。
- `/tool-style` 切换 tidy / claude；支持指定风格和 `--compact-style` 启动选项。
- 复用原生 fullscreen 单条点击；切换风格只调用行级 invalidate，不调用全局展开方法，不重新执行工具。
- 7 个内置工具直接委托当前 Pi 的官方 ToolDefinition，保留模型可见元数据，完整转发 ctx、signal 和 onUpdate。
- 使用 `pi.getSettings()` 的有效 shell / 图片设置；不自动激活 grep/find/ls。
- Edit 展开使用官方 `renderDiff()`，只消费返回的 diff。没有调用官方 Edit renderCall，因为该入口本身会计算文件预览。
- Write 展开只显示已经提供的新内容。
- 自定义工具通过 `decorateTool()` 显式接入。未接入的工具不动。
- 未新增意图 schema、文件预读取、上下文变换、结果变换、UI prototype patch、模型请求或持久化配置。

## 自动测试

环境：本机 Pi 0.99.1，测试 Node 24.20.0。

执行 `npm run check`：TypeScript 检查通过，**20 项测试通过，0 项失败**。

覆盖：

- 自定义工具原 execute / schema / prepareArguments / prompt / structured output / exposure / namespace / annotations 等引用保留。
- 自定义 execute 接收原参数、取消信号、流式回调和 ctx；返回对象、异常对象保持原身份。
- Bash 首行及剩余行数、Claude 调用标题、Read 行数、两种风格错误显示。
- 官方返回的 Edit diff、Write 新内容，无文件预览调用。
- 中文、emoji、tab、极窄终端和多行命令。
- 实际 Pi ToolExecutionComponent 的单条鼠标点击。
- 切换风格时已有工具行刷新、展开状态保留。
- 实际 PNG 文件读取，模型上下文转发与图片设置。
- 原生 iTerm2 图片协议输出，两种风格和文字展开状态下仍然保留；Pi showImages 开关仍有效。
- 官方 Write、多 block Edit、Read；有效 cwd 和 Bash shell prefix；取消和文件不存在异常。
- 实际 SDK 加载扩展与另一份自定义工具扩展；默认工具集合、命令切换、跨模块共享风格、reload。

完整输出：[`project-3-tests.log`](./project-3-tests.log)。

## 真实 TUI 检查

执行 `npm run test:tui`，在独立临时 agent directory 和工作目录中启动本机 `pi` CLI 的 fullscreen 模式。通过 PTY 输入真实鼠标和键盘事件。

会话历史中的工具结果来自实际本地 Write / Edit / Bash / Read 执行。为了不调用模型，工具调用消息由检查脚本构造后重放；没有发出模型请求，也没有使用真实用户的配置或认证文件。

验证通过：

1. 扩展加载，历史工具行使用 Claude 风格显示。
2. 点击 Bash 标题，出现实际输出的 second / third 行。
3. `/tool-style tidy` 刷新已有工具行。
4. `/tool-style claude` 切回。
5. 再点击 Bash，回到折叠行数摘要。
6. 正常退出。

实际 TUI 检查发现 `/compact` 与 Pi 的内置上下文压缩命令冲突，已改为 `/tool-style` 并重跑通过。

保留的结果：

- [`project-3-tui-check.log`](./project-3-tui-check.log)：执行摘要。
- [`project-3-fullscreen.ansi.log`](./project-3-fullscreen.ansi.log)：真实 fullscreen ANSI 输出与图片协议序列。
- [`project-3-tui-session.json`](./project-3-tui-session.json)：该次隔离会话的临时路径。

复现检查需要 PATH 中存在 `pi`、`expect` 和 `python3`：

```bash
npm run check
npm run test:tui
```

TUI 检查会在临时目录保存自己的结果路径。以上保留日志对应本次通过的运行。

## 当前边界

- 图片保留原生路径，尚未实现图片跟随单条文字折叠。
- 已验证图片数据和协议输出，没有做真实终端图片像素的截图检查。
- 尚未实现左右 diff、Run 聚合、详情弹窗、项目一的工具类别快捷键和 Markdown 自动展开。
- 单条点击需要 fullscreen。Ctrl+O 仍保留 Pi 原有的全局行为。
- 自定义工具需显式包装，未自动改动现有 fff 扩展。接管展示后不保留原 renderer 的特殊交互。
- 本次没有实际模型驱动的端到端会话。执行和 UI 链路分别经过实际工具、SDK 和真实 CLI 检查。
- 没有检查其他 Pi 版本。Peer 最低版本声明为本次验证的 0.99.1。
- 项目一 `tidy-tools.ts` 的用户未提交修改保持原样；参考二源码未修改。
- 本次未安装到用户 Pi 配置，也未提交 Git commit。
