# 02: 正确展示当前思考与未完成工具

**What to build:** aggregate 隐藏 thinking 时仍显示当前正在生成的最新一段；思考结束即隐藏。工具从参数生成到执行结束使用灰色背景，仅影响未完成区域。

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] 隐藏旧 thinking，当前生成的一段保留原生展开交互。
- [x] 开始工具、正文输出或任务停止后不保留 thinking，也不残留空行。
- [x] 参数生成和执行中的工具使用 Pi 原生 pending 背景。
- [x] 成功或失败后恢复原背景及错误展示；相邻已完成区域不变。
- [x] 工具名称颜色、图片、点击及 tidy / claude 行为不变。
