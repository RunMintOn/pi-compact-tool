# aggregate 展示偏好与多图性能验证

## 范围与实现

- 起点 commit：`5ed19f2288d5a97f7cd4333a68d4921b522efdf1`。
- 本地 tickets 位于 `.scratch/aggregate-display/issues/`，按 01 → 02 → 03 串行完成。实现和 review 均未使用 subagent。
- `/codemode-view compact|calls`：A 单行；B 使用原生 expanded result renderer，仅把传入 renderer 的 content 替换为空，从而取出整个嵌套调用区域。不修改实际结果，不复制原生参数、状态、错误或费用格式。全部调用显示；partial updates 可直接复用，因此支持实时刷新。
- 点击摘要或调用区域展开／收起整个 codemode。切换 A/B 保留工具展开状态，无嵌套调用时仍单行。
- `/tool-thinking show|hide`：仅在 aggregate 隐藏 assistant thinking 组件及其占位间距。原始 children 和 thinking 展开状态保留；普通文本、错误和统计不隐藏。区域边界计算忽略隐藏节点，串行工具连续，parallel 组保持分组间距。
- 两项偏好通过插件独立 JSON 自动保存到全局 agent directory，首次默认 compact + thinking 显示。reload 和另一项目恢复；/tool-style 保持现有不持久化行为。
- 未修改 Pi 宿主源码、工具执行、模型消息或图片协议。

## 行为验证

已执行：

```bash
npm run check
npm run test:tui
npm run test:display-tui
```

- typecheck 通过；完整测试 65 / 65 通过。
- 新行为通过真实 Pi SDK 命令和原生 ToolExecutionComponent / AssistantMessageComponent 验证，无模型请求。
- 覆盖：完整调用区域与原生 renderer 对照、超过原生收起预览数量的调用、长参数换行、嵌套错误、partial running 状态、窄宽度、点击整条展开、风格切换、独立偏好、自动保存、reload、不同项目恢复、非法命令、隐藏独立／streaming thinking、显示恢复后的原生点击、串行／parallel 间距、追加消息后的区域边界、普通正文和最终统计留白。
- 原有 fullscreen 回放检查通过，包括原生 thinking 点击、工具点击、三套风格切换和 reload。
- 新 fullscreen 回放检查通过：compact → calls → 点击嵌套行完整展开 → 切换偏好仍保持展开 → 收起 → thinking 隐藏／恢复 → reload 恢复已保存偏好。

本次详细日志保存在 worktree 外：

- `/tmp/pi-compact-final-check.log`
- `/tmp/pi-compact-native-tui.log`
- `/tmp/pi-compact-display-tui-final.log`
- 原有 fullscreen ANSI：`/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-tui-results-36qHrb/fullscreen.ansi.log`
- 新 fullscreen ANSI 与 session 描述：`/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-display-results-MjlOJn/`

## 图片性能对照

可复现最终实现的 CPU 测量：

```bash
PI_OFFLINE=1 node --import tsx scripts/diagnose-images.ts /path/to/image.png 300 > /tmp/pi-compact-images.json
```

脚本使用真实 Pi fullscreen `TuiAltScreen`、`ScrollView`、原生 Image、布局、差分输出和 Kitty 上传缓存路径。Terminal 接口只统计写入字节，不把图片绘制到真实窗口。固定 100 列 × 40 行、8 × 16 像素字符格；每个场景各滚动 60 帧。

本次输入为用户第一张 1906 × 850 PNG 截图（240,489 bytes），重复放入 300 个独立工具／图片组件；并非 300 张不同的图片。Node v24.20.0。

CPU profile 中主要开销为 `truncateToWidth`、文字区域排版和隐藏节点过滤。图片在稳定滚动期间无缓存失效。插件内加入：

1. AggregateShell 按宽度、outputPad 和 Bash 行数缓存已着色的文字行。内容更新及 invalidate 清除缓存。
2. 隐藏 thinking 时按区域节点数量缓存可见节点列表。追加节点时重建，避免每条工具、每帧重复过滤整个区域。

控制组为同一实现暂时绕过以上两个缓存；控制组和最终组均未开启 CPU profiler。测量原始数据保留在 `image-performance.json`。

| 场景 | 控制组 median / p95 | 优化后 median / p95 |
| --- | --- | --- |
| 原生 Pi | 1.03 / 1.54 ms | 1.08 / 1.59 ms |
| aggregate，thinking 显示 | 10.15 / 40.78 ms | 2.76 / 7.16 ms |
| aggregate，thinking 隐藏 | 20.44 / 37.19 ms | 1.65 / 2.18 ms |

两组每个场景稳定滚动期间 Image.render 均为 18,000 次，图片缓存失效均为 0，新增图片上传均为 5 次。文字缓存没有改变原生图片缓存与上传行为。显式组件 invalidate 后图片缓存重建仍与原生一致。

另一次 80 张 PNG 检查，优化后 median 为原生 0.81 ms、显示 thinking 1.16 ms、隐藏 thinking 0.96 ms。

**结论边界：** 测量确认并减少了插件重复文字排版的 CPU 开销。没有测量真实终端图片解码、GPU 绘制、输入到画面的延迟，也没有测量 JPEG 转换或大量不同图片的内存压力。没有复现并证明用户观察到的全部滑动卡顿已解决。没有因此改变图片自动显示行为或修改宿主。

## 串行 review

### Standards

按当前项目规则与 code-review 的 smell baseline 自审本次 diff 及新增文件。

- 合并两个命令重复的保存／通知代码，共用 updatePreferences。
- 两个缓存针对实测热点，均只保存单个宽度／当前区域列表，无新增依赖。
- 临时缓存旁路在测量结束后恢复，无诊断修改残留。
- 最终无未解决的 Standards findings。

### Spec

逐项检查对话约定和三个本地 tickets。

- 发现隐藏 thinking 后的索引仍指向原 children，可能误删最终回答前的正常留白。先新增失败断言，再修复为查询 visibleChildren；受影响测试与 fullscreen 检查重跑通过。
- A/B 只影响收起展示，thinking 开关独立；全局偏好恢复和 tidy / claude 不变均已验证。
- 图片结论限于实测 CPU 路径，不宣称真实终端卡顿已完全解决。
- 最终无未解决的 Spec findings。
