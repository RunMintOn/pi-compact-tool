# 01: codemode A/B 展示与全局偏好

**What to build:** 用户可通过 /codemode-view compact|calls 独立切换 aggregate 的收起展示。A 保持单行；B 在摘要下完整显示原生嵌套调用区域，隐藏脚本与输出。点击摘要或任意调用行展开整个 codemode，再次点击恢复所选模式。偏好跨项目、会话和 reload 保存，首次默认 A。

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] 无嵌套调用时 A/B 都保持单行；全部嵌套调用采用原生展开规则显示，不另行摘要或截断。
- [x] 原生完整展开内容、全局展开交互、现有工具执行与结果保持不变。
- [x] 简单复用现有 renderer 时实时显示 partial 调用；复杂时允许完成后显示，并记录原因。
- [x] 切换立即刷新已有记录，保留展开状态；tidy / claude 不受影响。
- [x] 全局配置只保存展示偏好，不改变 /tool-style 的保存行为。
- [x] 原生组件点击与命令/配置恢复经过验证。
