---
name: pi-compact-tool-adapter
description: 为 Pi 工具接入 pi-compact-tool 的紧凑渲染。用户要求适配自定义工具的展示、调整调用或结果摘要、保留展开详情，或在 pi-compact-tool 仓库新增自动适配时使用。
---

# 工具渲染适配

目标是让工具使用 pi-compact-tool 的展示和展开交互，保留执行行为及模型可见数据。
本 skill 随插件源码分发。下文路径均相对于本 skill 目录；先解析绝对路径，避免把用户工作目录当作插件根目录。

## 1. 确认工具的数据与接入位置

读取目标工具的完整定义、原有 renderer，以及有代表性的调用参数和结果。
确认工具的实际 `name`、`content`、`details`，成功、失败和流式结果的区别。
以源码、已有测试或保存的结果为依据；缺少关键结果结构时，先向用户索取一个样例。

按用户请求选择接入位置：

- **用户自己的工具插件**：在该插件原有 `pi.registerTool()` 处包装定义。默认采用这条路径，无需修改安装的 pi-compact-tool。
- **本仓库的自动适配**：用户要求本插件自动识别某个工具时，在 `../../src/custom-tools.ts` 中接入。

先明确收起时显示什么、展开时显示什么，以及需要保留的原生内容或交互。
仅要求渲染适配时，将执行、激活状态、工具统计和 `/changes` 快照保持在原有范围。

## 2. 读取当前实现

读取 `../../src/display.ts` 中 `DisplayAdapter`、`decorateTool()` 及相关渲染函数。
读取 `../../README.zh-CN.md` 的“自定义工具”小节，确认公开接入方式。
以当前源码为准；这个 skill 提供流程，不缓存完整 API。

需要保留原生 renderer，或新增自动适配时，再读取：

- `../../src/custom-tools.ts`：UI 局部定义替换、原生展开详情及恢复逻辑。
- `../../src/activity.ts` 中 `adaptCustomTool` 的调用位置：组件的接入与生命周期。
- `../../tests/custom-tools.test.ts`：原生 `ToolExecutionComponent` 的展示测试。

涉及 Pi renderer 的参数、组件 API 或版本差异时，读取用户实际 Pi 安装中的扩展与 TUI 文档和类型声明。

## 3. 实现最小适配

### 用户工具插件

复用现有注册入口：

```ts
import { decorateTool } from "pi-compact-tool/display";

pi.registerTool(decorateTool(existingTool, {
  kind: "search",
  target: args => `${args.pattern ?? ""} in ${args.path ?? "."}`,
  summary: result => {
    const count = (result.details as { totalMatched?: number } | undefined)?.totalMatched;
    return typeof count === "number" ? `${count} matches` : "done";
  },
}));
```

示例字段只适用于提供这些字段的搜索工具。按已确认的目标工具数据编写 adapter。
确认工具插件能够解析 `pi-compact-tool/display`；直接使用本地源码时，使用实际的 `src/display.ts` 路径。
跨包引用按用户项目的依赖配置处理，避免写入开发者机器的绝对路径。

`decorateTool()` 会替换原有 renderer。需要保留特殊 diff、按钮或其他交互时，先检查原实现，
再明确保留方式；仅用通用 adapter 不能保证这些交互仍可用。

### 本仓库自动适配

在 `adapter(name)` 中匹配已确认的工具名，提供 `kind`、`target` 和 `summary`。
沿用 `adaptCustomTool()` 的 UI 局部替换与恢复逻辑，保留工具注册表及执行定义。
需要保留展开详情时，参考现有 codemode / apply_patch 的包装方式。
原生 renderer 的上下文、背景、缩进和交互必须按实际组件检查，避免机械复制包装。

只有当前工具确实需要、现有 adapter 无法表达时，才扩展公共展示接口。
工具名需要现有类别配色时，检查 `../../src/render-utils.ts` 的 `toolLabel()`。

### 摘要规则

- `target` 描述调用目标，避免把整段脚本、补丁或文件正文塞入收起行。
- `summary` 优先使用结果中的实际数量；请求参数只能说明请求，不能证明执行结果。
- 缺少元数据时，从已返回的文本中提取有依据的信息，或显示简短状态。
- 对可选、旧版和流式字段做必要检查，避免 `undefined`、`NaN` 或误报成功。
- renderer 只格式化已有数据。文件读取、工具执行和模型调用保持在执行路径。
- 使用已有 `SummaryLine`、`Text`、宽度工具及主题能力，沿用样式切换和展开状态管理。

## 4. 验证并交付

按改动范围读取项目的测试脚本。优先补一个能在改动前失败的展示测试。
使用 `ToolExecutionComponent` 检查完整显示行为；fixture 的 `execute()` 可以直接抛错，
以保证测试不会为查看效果执行真实工具。

覆盖这次适配涉及的行为：

- 收起摘要包含目标和有证据的结果数量，隐藏完整正文。
- 展开能看到承诺保留的输出、diff 或原生详情。
- 成功、失败、部分结果，以及缺失元数据的回退。
- aggregate / tidy / claude 切换与窄宽度下的可见列数。
- 自动适配释放后恢复原 renderer；原工具定义与执行引用保持不变。

如果改动保留或改变了原生特殊交互，再用真实 TUI 检查相应交互，并保存可检查的结果。
将未执行的交互检查明确标为未验证。

在本仓库新增自动适配时，同步中英文 README 的工具支持说明，运行项目配置的类型检查和测试。
交付时说明修改位置、收起与展开行为、已执行的验证，以及用户如何加载或 `/reload`。
满足这些条件后停止，避免顺带改造工具执行或其他工具的展示。
