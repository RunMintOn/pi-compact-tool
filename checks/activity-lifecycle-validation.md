# 连续任务统计与运行状态验证

## 范围

基于 `7caab5023694804cc13da237467b8bd71b0ddb1d`，完成两个本地 ticket：

- [连续任务统计](../.scratch/activity-lifecycle/issues/01-summary-lifecycle.md)
- [当前思考与工具状态](../.scratch/activity-lifecycle/issues/02-live-display.md)

仅修改 aggregate。工具执行函数、模型消息、thinking 设置和 tidy / claude 保持原行为。

## 实现

- 使用 `agent_settled` 作为连续任务的统计展示与持久化边界。
- steering、follow-up 和续跑合并累计；新任务与已结算任务分开。
- 非模型上下文的 custom entry 保存统计快照和消息关联，避免 reload 重复及上下文压缩后丢失累计值。旧 entry 保持原有恢复路径。
- 纯回答同样显示统计。没有 usage 时省略 token，没有费用或有效 TPS 数据时不显示对应指标。
- 隐藏模式按 stream event 的 `contentIndex` 定位当前 thinking run，在 `thinking_end` 即隐藏；新的空 thinking 不会重新显示旧内容。
- 未完成工具复用 Pi 的 `toolPendingBg`，覆盖收起、展开、分组标题及留白。完成后恢复原背景，邻近已完成区域不变。
- TPS 保留最后一次 agent 运行的既有计算口径。

## 已执行的检查

环境：macOS、Node 22.23.2、Pi 1.2.0。

项目原有 Pi / TUI / typebox 软链接失效，本机验证改为指向当前 Pi 安装。测试环境补齐当前宿主要求的 `durationMs`、`outputPad`、renderer `state` 和 `setProgramStatus`，未增加依赖。

```text
npm run check
typecheck: PASS
tests: 74 passed, 0 failed

npm run test:display-tui
PASS compact / calls / expanded / hidden
PASS native nested-row clicks and preference restoration
PASS three consecutive reloads, exactly one statistics row per screen

git diff --check
PASS
```

关键回归检查：

- 真实 SDK `prompt → steer → followUp` 队列流程，模型 stream 在外部边界离线模拟，无网络模型请求。
- 中间 assistant 消息和 `agent_end` 后不显示统计，最终 settle 后仅在最后一条 assistant 消息下显示合并统计。
- 正常、错误、中止、最后消息包含工具调用的中止，以及停止后的独立任务。
- 真实 `session.reload()` 多次重载、上下文压缩后的统计值保留，以及运行中 rebuild 不提前结算。
- 原生 thinking 组件的展开交互、流式阶段切换、空 thinking 起点、正文保留及空行移除。
- 原生工具组件在 dark / light 主题中的参数生成、执行、partial result、展开、成功和失败背景；相邻完成工具的渲染输出保持不变。

fullscreen 检查使用已完成会话回放。运行中的 thinking 和背景阶段由原生组件及 SDK 事件检查覆盖，不将回放测试描述为真实模型运行中的视觉检查。

完整日志及 fullscreen 结果保存在 worktree 外：

- `/tmp/compact-final-check.log`
- `/tmp/compact-final-display-tui.log`
- `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-display-results-dJ5LYt/`

## Review

按 Standards / Spec 两个方向直接 review，未使用子代理。

- **Standards:** 未发现剩余阻塞项。沿用现有展示投影、原生组件和持久化 entry，没有新增依赖或通用适配框架。
- **Spec:** 五项要求均有行为检查。review 发现的空 thinking 重新显示旧内容、缺失 usage 显示零 token 两项已先建立失败检查，再修复并重跑。
