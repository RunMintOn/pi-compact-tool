# reload 后统计重复：渲染包装共存验证

## 复现

原有 lifecycle 测试单独加载 compact-tool，5 项通过，未覆盖后加载的 assistant 渲染包装。
本机配置在 compact-tool 后加载 `pi-raw-mode`。raw mode 关闭时也会转发到安装时捕获的 render。

新增 fixture 保留这个最小行为：session_start 包装 assistant render，session_shutdown 仅在仍拥有该方法时还原。
使用真实 `session.reload()`，检查历史回复和最新回复，以及保留和新建的组件。

修复前执行：

```sh
node --import tsx --test --test-name-pattern='reload with a later' tests/lifecycle.test.ts
```

结果：`reload 1, reply 1`，预期 1 份统计，实际 2 份。
日志：`/tmp/compact-reload-red.log`。

## 修复

compact-tool 先退出时，外层包装仍拥有 prototype.render，所有权检查无法移除内层旧方法。
外层退出后可能恢复该旧方法；下次安装又包住它。旧方法仍追加统计。

退出时标记包装已释放。即使方法被外层保留，也只转发原调用，不再执行统计、布局和工具适配。
退出操作同时保持幂等，不覆盖其他扩展的方法。

未修改 pi-raw-mode、用户配置或会话内容。
已运行的旧版本包装没有这个标记，需要重启 Pi 清除旧链；后续 reload 使用新逻辑。

## 修复后验证

```sh
npm run check
npm run test:display-tui -- /Users/ziqian/20-dev/20-ecosystems/01-pi/extensions/pi-raw-mode/extensions/index.ts
git diff --check
```

- 类型检查通过，77 项测试通过。
- 新增回归测试连续 reload 5 次，历史和最新回复均保留一份统计，统计内容不变。
- 真实 Pi fullscreen 同时加载 compact-tool、builtin:codemode 和本机 pi-raw-mode，连续 reload 3 次，每次屏幕均只有一份统计。
- 原有展示偏好、嵌套工具点击和展开检查通过。终端验证使用已完成会话回放，不发送模型请求。

检查日志：`/tmp/compact-reload-check.log`、`/tmp/compact-reload-raw-tui.log`。
终端结果：`/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-display-results-iUqjHW/`。
