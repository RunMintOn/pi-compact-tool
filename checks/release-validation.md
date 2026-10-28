# 0.1.0 发布验证

## 发布内容

- 包名 `@runminton/pi-compact-tool`，版本 0.1.0，首次发布到 npm。
- tarball 21 个文件、62.9 kB，解包 194 kB。`files` 只含 `index.ts`、`src`、`skills`、两份 README、CHANGELOG 和 LICENSE；`checks/`、`tests/`、`scripts/`、`assets/` 不进入包。
- 宿主包在 `peerDependencies` 中声明为 `*`。旧声明的 `>=0.99.1 <1` 排除了 1.x，而 0.99.2 之后 Pi 已到 1.4.0。
- `pi.image` 使用仓库内的 `assets/preview.png`（1422×889，16:10），画廊卡片按 16:10 裁剪显示。

## 自动测试

```bash
npm run check        # 类型检查 + 104 项测试
npm run test:tui     # 真实 Pi fullscreen（pty）
npm run test:display-tui
npm pack --dry-run
```

发布前四项全部通过。

## CI 首次运行失败与修复

GitHub Actions 首次运行 104 项中 2 项失败，本地全部通过：

- `tests/display.test.ts` 的颜色预览断言
- `tests/preferences.test.ts` 的偏好恢复断言

两者都通过 `initTheme()` 取得真实主题，颜色模式由 `COLORTERM` 决定。CI 没有该变量时降级为 256 色，断言里的 RGB 序列不再出现。本地已用 `env -u COLORTERM -u TERM npm test` 复现同样的 2 项失败，确认不是代码缺陷。

修复放在测试侧而不是 CI 环境：两个测试文件在 `initTheme()` 之前设置 `process.env.COLORTERM ??= "truecolor"`，让颜色模式由测试固定，而不再依赖调用方的终端。这样 CI、ssh、tmux 等没有该变量的环境结果一致。修复后本地有/无 `COLORTERM` 均为 104 项通过，CI 转绿。

`v0.1.0` tag 因此移动到包含该修复的提交。

## 安装冒烟

隔离环境，不触碰本机 Pi 配置：

```bash
PI_CODING_AGENT_DIR=/tmp/pi-rel-test pi install npm:@runminton/pi-compact-tool
```

启动诊断显示 `[Extensions] @runminton/pi-compact-tool` 与 `[Skills]` 中的 `pi-compact-tool-adapter`，没有 `Extension Error` 或 `Failed to load`。这验证了 npm 安装路径下扩展与 skill 都会被包发现机制加载，而不只是 `-e ./index.ts` 单文件加载。

## 发布后观察

- 塔布的 `/-/pi-compact-tool-0.1.0.tgz` 和 `/<pkg>/0.1.0` 立即可读，但 packument（`GET /@runminton%2fpi-compact-tool`）约 5 分钟后才返回 200。这段时间 `npm view` 与 `pi install` 都会 404，属于 registry 元数据延迟，不是发布失败。
- `assets/*.png` 的 raw 地址在 push 后返回 200，`pi.image` 才可用。

## 未覆盖

- `npm run test:changes-ui` 需要 ego-browser 打开浏览器窗口，本轮未运行。
- pi.dev/packages 收录依赖外部索引，发布当时尚未出现。
- npmmirror 等镜像同步未验证。
