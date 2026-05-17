# Windows 客户端

基于 Electron + React + TypeScript 的 Pi 智能体 Windows 桌面客户端。

## 当前范围

- 桌面客户端空壳与本地环境展示。
- 通过 Electron main process 选择工作区文件夹。
- 工作区选择会写入 Electron `userData/logs` 下的 JSONL 审计日志。
- 客户端内置审计日志查看区域，可查看最近的本地动作记录。
- 工作区文件浏览与小型文本文件预览，访问范围限制在当前工作区内。
- 顶层功能域拆分为工作区、智能体和配置中心，避免操作入口和配置入口重复。
- 配置中心按功能域拆分为智能体内核、模型 Provider、业务能力三组，各自独立保存。
- 模型配置采用列表 + 弹框管理，支持官方 Provider、国内 OpenAI 兼容厂商、本地模型、自定义模型和扩展注册 Provider。
- 模型列表支持按 Provider、接入方式、启用状态、文本/视觉能力、是否支持思考做字段筛选。
- 已知 Provider 走模型候选下拉；自定义 Provider 和本地模型保留手动输入模型 ID。
- 模型档案预留 Pi agent/provider 关键字段：provider、model、api、baseUrl、auth、thinking、transport、retry、compat、文本/视觉、上下文窗口、最大输出长度、价格和联通状态。
- 每个 Tool / Skill 业务能力支持独立保存、删除和启用状态。
- Tools / Skills 采用列表 + 弹框管理，支持按类型、执行方式、触发方式、启用状态筛选。
- 业务能力档案预留 HTTP API、本地命令、内置能力、MCP、手动占位等执行方式，以及 schema、超时、重试、认证、联通状态和未来智能体引用关系。
- 类型化 preload API 与 IPC channel 常量。
- RPC 形态的 Agent Adapter 已接入本地 Pi RPC 子进程，启动会话时会根据已启用的默认模型生成 Pi `models.json` 并发送真实 RPC 消息。

## 脚本

```bash
npm install
npm run windows:dev
npm run windows:typecheck
npm run windows:build
```

## 说明

第一阶段暂不实现 OCR 全流程。当前优先稳定客户端空壳、工作区权限边界、审计日志、模型配置和本地 Pi RPC 真实链路，再继续接入 OCR prompt 优化工作流。
