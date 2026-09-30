# 本轮修改查看验证

## 实现范围

- 只观察本扩展官方 Edit / Write 的写入操作，包括通过这些工具定义执行的嵌套调用。
- 起点快照在官方文件写入队列内保存，路径使用官方传入的绝对路径，随后按真实路径合并别名。
- `agent_settled` 结算整个任务，自动续跑不重置起点。只重新读取已登记的文件，不扫描仓库。
- 净 diff 复用 Pi 的 `generateUnifiedPatch`（底层 jsdiff），解析／展示使用 diff2html 3.4.56。
- aggregate 统计第一行追加 OSC 8 `View changes`，优先保留后缀。第二行日期不变。`/changes` 等待任务结束，打开最近生成的 HTML。
- HTML 包含完整用户消息文本、时间、任务状态、文件与行数统计、文件侧边栏、Auto / Split / Unified、Wrap lines、自动明暗主题。
- 只保存独立 HTML，不保存额外原始快照或历史索引。链接关联不跨 reload／会话切换恢复。
- 1 MiB 单文件上限、16 MiB 起点快照预算。无法比较的文件明确显示 Unavailable。

## 自动测试

```bash
npm run check
```

类型检查通过；工作区的 57 项测试通过，0 失败。提交前另将暂存内容导出到独立临时目录验证，排除用户已有费用统计改动后，55 项测试通过，0 失败。本次新增 9 项测试：

- 多次 Edit / Write 合并成原内容到最终内容的净 diff，覆盖已有未提交内容、新文件连续覆盖和不相关文件排除。
- Write 覆盖显示删除行；恢复原样的文件不计入；失败 Edit／预先取消不显示为修改。
- 并行调用、真实路径别名和自动续跑保留首次快照。
- 二进制与超大文件标为 Unavailable；已跟踪文件删除和空文件创建保留类型。
- 特殊文件名、完整用户消息和代码中的脚本作为数据保留；HTML 自包含且保存后内容固定。
- 非活动任务时快照记录不影响工具；reset 仅清理内存关联。
- 窄统计行保留链接且不超过宽度；第二行与原有结果完全相同。
- 实际 Pi Session 加载扩展、执行官方 Write，直到结算才出现链接；页面包含状态和完整用户消息；未新增模型可见消息。同一运行内的 transcript rebuild 保留关联。
- `/changes` 等待结算、使用参数数组调用系统打开程序；启动失败给出文件链接。

## 浏览器检查

```bash
npm run test:changes-ui
```

脚本通过真正的 Edit / Write 生成三文件样例，使用 ego-browser 打开本地 `file://` 页面。无需模型调用。7 组检查通过：

1. 1440 px 宽窗口自动双栏，文件数与增删行数正确，没有页面横向溢出。
2. 用户消息可展开，完整文字保留，长消息区域有滚动，嵌入脚本没有执行。
3. 侧边栏跳转到末尾文件；双栏 Wrap lines 生效，长行不撑大窗格。
4. 切换单栏保留当前文件、阅读位置和 Wrap lines 状态。
5. 模拟系统暗色偏好，页面自动改变配色。
6. 600 px 窄窗口自动单栏，通过 Files 打开侧边栏并定位文件；没有整页横向溢出。
7. 手动 Split 不被窗口变化覆盖；恢复 Auto 并扩大到 1600 px 后自动双栏。

本次结果：`/tmp/pi-compact-changes-qa/results.json`。

截图：

- `/tmp/pi-compact-changes-qa/light-split.png`
- `/tmp/pi-compact-changes-qa/dark-unified-wrap.png`
- `/tmp/pi-compact-changes-qa/narrow-unified.png`

已读取浅色双栏、暗色单栏长行折行及窄窗口截图进行视觉检查。Wrap lines 最初造成行号区域过宽，已修复，并重跑上述浏览器检查。布局重排的滚动位置也已修复并验证。

## 原有 TUI 回归

```bash
npm run test:tui
```

真实 Pi fullscreen 的连续 Think／工具面板、原生单条点击、三种风格切换、reload 和正常退出检查通过。测试没有模型请求。

此检查针对原有交互回归。新链接的宽度与 OSC 8 地址通过组件测试验证；报告页面通过真实浏览器打开验证。尚未通过真实终端鼠标点击新链接，或实际运行系统默认浏览器启动命令；后者的命令路径使用测试替身验证。Windows／Linux 的打开方式未在对应系统执行。

## 打包与依赖

- `npm pack --dry-run --json` 确认 `src/changes.ts`、页面模板、浏览器 JS 和 CSS 都包含在包中。
- runtime 只新增 diff2html；Pi 宿主包继续使用已有安装的软链接。
- 使用 `npm install --ignore-scripts --legacy-peer-deps`，不将 Pi 的第二份副本写入锁文件。
- `npm audit --omit=dev --legacy-peer-deps`：0 vulnerabilities。
- 自包含页面保留内嵌库的许可证／版权说明。
- 用户已有未提交修改保持不动；本功能与此前费用统计改动分开暂存。
