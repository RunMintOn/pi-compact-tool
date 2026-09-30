# 渲染回调旧上下文异常修复

## 问题与范围

用户堆栈指向 `index.ts:49:70`：渲染回调通过 `ctx.ui.theme` 读取已失效的会话上下文。另一个渲染回调通过 `pi.getSettings()` 读取缩进，也受运行时失效限制。

实际 Pi SDK 最小复现：只加载本插件，创建原生 Think/工具调用消息组件；有效会话渲染成功，`session.dispose()` 后重绘抛出同样的 stale ctx 错误。这个复现验证失效后重绘路径，不代表已确认用户当时执行了 dispose、reload 或哪一种会话切换操作。

## 修改

- `index.ts` 在有效的 `session_start` 中取得主题对象与初始 outputPad。渲染回调不再访问捕获的 ctx 或 pi。
- `src/activity.ts` 缓存初始 outputPad，并在原生 assistant render 时使用组件自身的 outputPad 更新它。原生消息组件跟随 `/settings` 更新缩进，无需渲染时调用会话 API。
- 保留原生 Think 内容、折叠与点击，工具背景、标题、统计、图片协议及工具执行不变。
- 新增真实 SDK 回归测试：会话失效前后 Think 与工具行输出一致；失效后修改原生 outputPad，工具缩进继续更新。

## 已执行验证

- 新增测试在修复前失败，错误明确指向 `index.ts:49:70` 的 stale ctx 读取。
- `npm run check`：TypeScript 通过，43 项测试通过，0 项失败。
- `npm run test:tui`：实际 fullscreen 历史回放、Think/工具点击、三种风格切换、reload、退出通过，无模型请求。
- 原始最小复现重跑：`Active session render: OK`、`Disposed session render: OK`。
- `git diff --check` 通过。

日志：

- `/tmp/pi-compact-stale-red.log`
- `/tmp/pi-compact-stale-check.log`
- `/tmp/pi-compact-stale-tui.log`
- `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-tui-results-1WPh6Z/fullscreen.ansi.log`

未复现用户当时的完整操作顺序；未发起真实模型流式请求，未验证用户终端的图片像素。没有修改全局配置，没有提交或推送。已有未提交工作全部保留。
