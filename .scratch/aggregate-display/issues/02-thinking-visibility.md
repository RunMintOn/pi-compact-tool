# 02: thinking 显隐与连续工具间距

**What to build:** 用户通过 /tool-thinking show|hide 控制 aggregate 全部 thinking，包括独立与运行中 thinking。隐藏后无占位行，串行工具连续，parallel 组保留分组间距。此偏好与 A/B、工具展开状态独立，跨项目、会话和 reload 保存，首次默认显示。

**Blocked by:** 01: codemode A/B 展示与全局偏好。

**Status:** completed

- [x] 隐藏 thinking 不修改模型设置、消息、内容或原有 thinking 展开状态。
- [x] 显隐切换立即刷新已有记录；恢复显示后原生点击仍正常。
- [x] 普通正文、执行错误、最终回答和统计不受影响。
- [x] serial / parallel、历史恢复、运行中显示及 tidy / claude 回归经过验证。
