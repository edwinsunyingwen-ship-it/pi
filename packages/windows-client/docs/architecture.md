# Windows 客户端架构

## 第一阶段范围

- Electron、React 和 TypeScript 桌面客户端空壳。
- 工作区选择作为本地文件权限边界。
- JSONL 审计日志写入 Electron `userData/logs`。
- RPC 形态的 Agent Adapter 接口，已接入本地石斧智能体运行时子进程。

## 模块结构

```text
src/main
  agent/agentAdapter.ts
  services/auditLogger.ts
  services/agentService.ts
  services/configService.ts
  services/workspaceFileService.ts
  services/workspaceService.ts
src/preload
  index.ts
src/renderer
  src/App.tsx
src/shared
  ipc.ts
  types.ts
```

## 适配器边界

Renderer 不直接调用石斧智能体运行时。Renderer 的业务动作先经过 IPC，再由 main process 调用 `AgentAdapter`。

第一阶段适配器方法：

- `startSession()`
- `sendUserMessage()`
- `stopSession()`
- `getSessionState()`
- `listAvailableTools()`

## 审计基线

工作区选择和 Agent Adapter 动作都会写入 JSONL 审计记录，包含动作名称、工作区路径、时间戳、批量标记和状态。后续文件操作、工具调用、API 调用和 OCR 验证动作也应统一通过 `AuditLogger` 写入。

## 本地石斧智能体运行时链路

`RpcAgentAdapter` 在 main process 中启动本地石斧智能体运行时子进程，并通过 stdin/stdout JSONL 协议通信。开发环境下优先使用仓库源码入口 `packages/coding-agent/src/cli.ts`，生产构建后预留使用 `packages/coding-agent/dist/cli.js`。

启动会话时，`AgentService` 会从 `ConfigService` 读取已启用的默认模型；如果默认模型未启用，则退回第一个已启用模型。适配器会把该模型写入 Electron `userData/pi-runtime/models.json`，并通过 `PI_CODING_AGENT_DIR` 和 `PI_CODING_AGENT_SESSION_DIR` 隔离石斧智能体运行期配置和会话文件。

当前实现支持官方 API Key Provider、自定义 OpenAI 兼容 Provider、本地模型等通过 `models.json` 可表达的模型配置。外部 RPC 服务模式仍保留在配置模型中，后续再接入网络 RPC endpoint。

## 工作区文件边界

`WorkspaceFileService` 只允许访问用户已选择工作区内的文件。第一阶段支持列出文件和读取小型文本文件，并会对文件列表和文件读取动作写入审计日志。后续新增文件、复制后编辑、diff 和批量处理也应复用这一边界。

## 前端功能域

Renderer 按功能域划分为三个顶层区域，避免使用入口和配置入口互相重复：

- 工作区：选择项目目录、查看本地环境、浏览和预览工作区文件。
- 智能体：启动/停止会话和进行智能体对话。
- 配置中心：管理模型、内核/RPC、Tools/Skills 和审计日志。

配置中心内部再通过子 Tab 划分配置项；模型和 Tools/Skills 都采用列表加弹框的资产管理模式，Tools/Skills 子页同时展示当前智能体可见业务能力，审计日志只保留在审计子页。

## 本地配置

`ConfigService` 将客户端配置保存到 Electron `userData/config.json`。配置按功能域拆分为 `agentCore`、`model` 和 `capabilities`，并提供独立保存入口，避免模型配置、RPC 配置和业务能力互相覆盖。

- `agentCore`：记录内置 RPC 子进程或外部 RPC 服务，以及 RPC 地址。
- `model`：模型资产目录，包含默认模型 ID 和多个模型档案。模型档案对齐石斧智能体 agent/provider 常见形态，记录接入方式、provider、model、api、baseUrl、认证方式、API Key 环境变量、thinking 等级、transport、请求超时、重试次数、compat JSON、文本/视觉能力、上下文窗口、最大输出长度、价格、联通状态和未来智能体引用关系。
- 模型配置 UI 以 API Key 方式为主路径，OAuth 和云厂商认证作为预留接入方式。已知 Provider 提供模型候选列表，自定义 Provider、本地模型和 `models.json` 接入允许手动输入模型 ID。
- `capabilities`：统一抽象 tool 或 skill，可配置分类、描述、触发方式、执行方式、接口地址、本地命令、工作目录、Token 环境变量、请求头、输入/输出 schema、超时、重试、启用状态、联通状态、标签和未来智能体引用关系；企业 API 属于具体 tool/skill 的执行目标，不作为客户端顶层特殊模块。

保存模型配置、保存内核配置、保存/删除单个业务能力和恢复默认配置都会写入审计日志。本地石斧智能体运行时启动时会优先读取这里的模型配置。
