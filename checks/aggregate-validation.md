# 紧凑工具记录与末尾统计：验证记录

## 本次实现

- 默认风格改为 `aggregate`。`/tool-style aggregate|tidy|claude` 保留三套风格，原地刷新并保留每条的展开状态。
- aggregate 将调用及结果摘要合为一行，共用背景，移除原生工具行前的空白。单次调用和多调用的工具名保持左侧相同缩进。
- 同一条 assistant 消息的多调用构成候选 parallel 组。新调用观察工具开始／结束事件，实际串行不画线；重叠调度的调用画左侧短竖线。旧记录没有事件时，用同消息多调用恢复分组，不能据此证明实际执行时间重叠。
- Think / assistant 旁白不决定工具分组，保持原生渲染、位置和点击展开交互。没有插入 Batch 标题。
- Bash 成功、失败均显示行数。新调用用官方结果的输出数据计数，排除无输出与退出状态说明；有截断时使用输出行数元数据并显示 `truncated`。旧历史无行数数据时回退到返回文字的行数，可能包含状态说明。不为计数读取完整输出文件。
- 失败行文字变红，收起隐藏错误正文；展开保留完整错误。失败 Edit 不显示成功修改统计。
- 最终回答后显示本次请求的分类计数、assistant turns、墙钟耗时、token 和本地日期时间。计数包含失败调用；没有额外的 `at`。窄终端优先保留日期时间，其他统计可截断。
- 工具执行、schema、取消、流式更新、结果引用和模型可见内容保持原定义。新调度标记、Bash 行数及请求时间通过非上下文 custom entry 保存，供历史回放和 reload 使用。
- 原生工具 `render/handleMouse` 和 assistant `render` patch 仅在 TUI 会话安装，reload / shutdown 恢复。没有 patch Think、全局 Container、工具执行或图片层。
- 点击使用原生单条展开／收起。本次没有独立详情弹窗、整块折叠或图片随文字折叠。

## 自动检查

本机宿主 Pi 0.99.1。

`npm run check`：TypeScript 检查通过，**29 项测试通过，0 项失败**。完整日志：[aggregate-tests.log](./aggregate-tests.log)。

新测试覆盖：

- Think 不定义并发组；没有 Think 的连续单次调用不合成 parallel 组。
- 串行与重叠工具事件、调度记录保存及恢复。
- 两个用户请求各自的分类计数和统计；最终回答后追加统计。
- Bash 通用行数、失败、无输出、截断与真实官方 Bash 的退出状态说明。
- 失败 Edit 的收起颜色、隐藏错误及展开完整错误。
- 极窄宽度、中文、emoji、多行命令；行数和日期的显示预算。
- 实际 ToolExecutionComponent 的紧凑高度、鼠标坐标、点击展开与风格切换。
- 实际 AssistantMessageComponent 的原生 Think 点击及统计位置。
- Patch 恢复和实际 SDK 加载／reload。
- aggregate 的原生 iTerm2 图片协议和 showImages 开关。既有执行委托、图片设置、自定义工具和 diff 测试继续通过。

## 真实 fullscreen 检查

`npm run test:tui` 在隔离临时目录中启动本机 Pi CLI，没有模型请求，没有修改用户的常用配置。

会话种子来自实际本地 Write / Edit / Bash / Read。前三次调用分别属于三个单调用 assistant 消息，中间没有 Think；后面三个 Read 用 `Promise.all` 执行并记录观察事件。思考和最终回答是固定样例。

验证通过：

1. aggregate 默认启动，连续单次 Write / Edit / Bash 紧贴排列且不带竖线。
2. 三个 Read 有左侧竖线；失败 Read 收起不显示 ENOENT 正文。
3. 分类计数与带日期统计位于最终回答之后。
4. 点击 aggregate Bash 展开实际输出 second / third。
5. 切换 tidy、claude，保持展开状态；再次点击收起。
6. 切回 aggregate 后点击仍正常。
7. `/reload` 后恢复默认 aggregate、保存的 parallel 标记和末尾统计。
8. 正常退出。

保留结果：

- [aggregate-tui-check.log](./aggregate-tui-check.log)：检查摘要。
- [aggregate-fullscreen.ansi.log](./aggregate-fullscreen.ansi.log)：真实 fullscreen ANSI 输出。
- [aggregate-tui-session.json](./aggregate-tui-session.json)：隔离会话路径。

## 验证限制与修复记录

- Fullscreen 文本交互检查禁用测试会话的图片像素显示，避免大图将待点击行挤出视口。图片数据与协议输出由实际工具组件测试单独覆盖；没有验证终端图片像素截图。
- 首次 fullscreen 检查因测试图片占据视口、待点击 Bash 行离开屏幕而失败。调整隔离测试的 showImages 后重跑通过，没有修改生产图片显示策略。
- 新行宽测试最初混用 UTC 输入与本地显示日期，修正为固定本地日期后重跑通过。
- 真实 Bash 新测试最初缺少官方工具所需的 sessionManager，补上隔离内存会话后重跑通过。
- 没有模型驱动的完整端到端会话；执行、投影、SDK 和真实 CLI 分层验证。
- 只验证本机 Pi 0.99.1。原生组件内部字段在其他版本的兼容性尚未检查。
- 旧记录没有精确事件时，无法判断显式串行调度；历史竖线只能表示同消息多调用。旧请求耗时依赖消息／持久化时间戳估算。
- 没有安装到用户配置，没有提交 commit，没有改动相邻项目或参考快照。

复现：

```bash
npm run check
npm run test:tui
```
