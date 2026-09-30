# Think 与工具连续背景验证

## Git 基线

本项目此前没有 Git 仓库。本次按用户要求初始化并提交修改前版本：

- `a398ec4` — `feat: baseline compact tool panels and request statistics`
- 提交包含插件源码、测试、脚本、说明和已有验证资料。
- `node_modules/` 和第三方参考快照 `reference-2/` 被忽略，文件保留原位。
- Think 融合的本次改动未自动提交，没有配置远端或执行 push。

## 实现

- ActivityProjection 的连续区域现在包含 Think 节点和工具节点。普通正文仍打断区域；工具调度分组与统计内容不变。
- 保留原生 Think 的 Text/Markdown、原生 MouseRegion 和折叠状态。
- assistant render 临时包装 Think 行及相关 spacer，通过原生 Container 渲染，原生鼠标布局记录实际高度。包装层排除留白点击，再把 Think 内容点击转发给原生 MouseRegion。
- Think 与工具采用相同背景，不在连接处插入空白行。区域首尾保留已有留白，原生 outputPad 保持不变。
- 同一 assistant 消息同时包含 Think 和正文时，只给 Think 加背景。普通正文、旁白、末尾统计继续无背景。
- 流式 Think 在尚未进入投影时使用临时独立面板边界，不提前修改请求统计；消息完成进入投影后使用完整的连续区域边界。
- 风格切换时恢复其他风格原生 Think 外观。release 清除装饰产生的鼠标布局缓存，原生折叠状态不变。
- 图片仍保留所属工具位置和原生协议，既有图片两侧留白规则不变。

## 已执行验证

```bash
npm run check
npm run test:tui
```

- TypeScript 通过。
- 38 项测试通过，0 项失败。
- 新增 3 项 Think 实际组件测试，在旧实现上确认失败后实施。
- 覆盖连续 Think/工具布局、同消息多段 Think 与普通正文、各段独立点击、留白点击、展开状态跨风格保留、窄宽度、release 后原生外观和流式 Think。
- 真实 Pi fullscreen 回放检查 Think 和工具共用连续背景，并实际点击 Think 展开／收起。
- 真实工具点击、tidy/claude/aggregate 切换及 reload 检查通过。
- `git diff --check` 对本次已跟踪文件改动通过。基线中的历史 ANSI 日志保留终端原始空格与换行，未清洗日志。

## 可检查结果

详细结果位于 worktree 外：

- `/tmp/pi-compact-thinking-red.log`
- `/tmp/pi-compact-thinking-check.log`
- `/tmp/pi-compact-thinking-tui.log`
- `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-compact-tui-results-hrcWz2/fullscreen.ansi.log`

## 边界

真实 fullscreen 使用实际本地工具输出构造的历史回放，没有模型请求。流式 Think 由实际组件测试驱动，没有模型驱动流式 E2E。PTY 检查关闭图片像素显示，图片协议仍由既有组件测试覆盖。尚未获得用户对本轮布局的视觉反馈。
