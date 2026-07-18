# HICOOL MTClaw 竞赛产品实施规划

## 文档定位

本文是竞赛版本的总实施规划。产品分层、请求模式和执行闭环以
[`hicool-product-architecture.md`](./hicool-product-architecture.md) 为准，三个专业 Subagent 的业务边界和验收合同以
[`hicool-subagent-contracts.md`](./hicool-subagent-contracts.md) 为准。

## 项目边界

- 唯一工作目录是 `D:\codexProject\staix-mtclaw-correct-architecture`。
- 不修改 `D:\codexProject\New project` 和旧的 `D:\codexProject\staix-mtclaw`。
- 尽可能保持原 Staix 产品层不变，包括会话、历史、附件、工作区、智能体配置、模型凭据、能力、Skill、知识、任务模板和审计展示。
- pi-agent 继续作为完整 Agent Runtime，负责上下文、工具调用、文件、Shell、工作区、附件、Skill、主/子智能体运行、权限和用户确认。
- MTClaw Function Router 是 pi-agent 使用的 OpenAI-compatible 模型 Provider 和专业任务路由层，不替代 pi-agent。
- 保留 MTClaw `functions.jsonl`、同名 shell wrapper、stdin/stdout JSON 协议和退出码语义。
- Windows 仅用于开发；正式交付目标为 Ubuntu 22.04 / MTT AIBOOK AIOS 1.4.2。

## 已确定的三个专业 Subagent

1. **企业主体核验与风险尽调**：完成主体消歧、工商核验、经营与司法风险归类，并输出带来源和查询时间的尽调结果。
2. **法规和类案研究**：围绕法律问题检索有效法规和相似案例，区分资料效力层级并输出可追溯研究结论。
3. **合同相对方与合同风险审查**：识别合同主体和交易结构，核验相对方，分析核心条款并给出原文定位、风险等级和修改建议。

第三个 Subagent 可以编排前两个 Subagent，但仍须具备独立输入、输出、失败语义和验收样例。

## Tool、Skill 与 Subagent

- **Tool**：单一、确定性的原子能力，例如企业信息查询、法规检索、案例检索、OCR 或文档渲染。
- **Skill**：指导智能体如何组合工具和执行专业流程的规则、模板与检查清单。
- **Subagent**：由 pi-agent 隔离运行、面向完整业务目标、可调用多个 Tool/Skill 并返回结构化成果的专业智能体。
- **Function Router**：根据用户意图自动选择或编排专业 Subagent，不要求用户手动 `@`、切换智能体或切换业务模式。

Staix 中已有的模型、Tool、API、MCP、Skill、浏览器、Shell、文件和知识配置继续由 pi-agent 使用，不在 MTClaw 中重复配置。MTClaw 只维护竞赛专业 Subagent/Workflow 的路由描述和必要的桥接入口。

## 目标运行链路

```text
Staix 产品层
  -> AgentService
  -> RpcAgentAdapter
  -> pi-agent Runtime
      -> 普通模式：当前智能体回答模型
      -> MTClaw 模式：MTClaw Function Router
          -> Router 模型选择专业 Subagent/Workflow
          -> pi-agent 启动真实子智能体并执行已配置能力
          -> MTClaw 调用当前智能体回答模型生成最终回答
      -> 保存主会话、子任务、工具调用和模型调用审计
```

这里的箭头不是单向流水线。MTClaw 在回答模型之前负责专业路由；pi-agent 在调用 MTClaw 前后都持续负责上下文、执行、权限和审计。

## 请求模式

### 普通模式

- pi-agent 直接调用当前智能体配置的回答模型。
- Staix 原有通用工具、Skill、附件、工作区和权限系统保持可用。
- 不经过 MTClaw 专业路由。

### MTClaw 模式

- pi-agent 将组装后的 OpenAI-compatible 模型请求发送给 Function Router。
- 独立 Router 模型只负责路由和专业能力选择。
- 被选择的专业 Subagent 由 pi-agent 真实运行并复用 Staix 能力配置。
- 当前智能体配置的模型负责最终回答。
- 竞赛版本默认开启 Router，连续演示期间不得依赖手动切换模式。

## 实施阶段

### 阶段 1：审计与架构基线

- 完成功能迁移矩阵和代码现状审计。
- 验证 Staix 产品能力与 pi-agent Runtime 的保留情况。
- 固化产品架构、信息流、执行流和三个 Subagent 合同。
- 标记“当前已实现”和“目标待实现”，避免架构图超前于代码。

### 阶段 2：真实 pi-agent 子智能体 Runtime

- 将 Staix `childAgentIds` 从提示信息升级为真实可执行配置。
- 支持隔离上下文、模型和能力绑定、取消、超时、错误传播和审计关联。
- 复用 pi-agent 已有扩展机制，不建立第二套 Agent Runtime。

### 阶段 3：MTClaw 到 pi-agent 的委托桥

- 验证 MTClaw 当前源码支持的内部 wrapper 与标准 tool-call 委托路径。
- 选择能够同时证明 MTClaw 自动路由、pi-agent 真实执行且不绕过权限的方案。
- `functions.jsonl` 只注册三个专业 Subagent/Workflow 及必要专业工具。
- 同名 wrapper 只承担协议桥接，不承载重复业务实现或凭据。
- 建立稳定的主会话、Router session、子任务和工具调用关联标识。

### 阶段 4：企业主体核验与风险尽调

- 复用 Staix 已配置的 QCC MCP/CLI 或获授权接口。
- 完成实体消歧、工商核验、风险归类、来源和时间戳。
- 建立正常、歧义、无数据、接口失败和权限不足验收样例。
- 证明 Router 自动命中、pi-agent 执行和回答模型汇总的完整链路。

### 阶段 5：法规类案与合同审查

- 实现法规和类案研究 Subagent。
- 实现合同相对方与合同风险审查 Subagent。
- 验证合同审查对子任务的自动编排和证据回传。
- 对三个 Subagent 使用一致的运行、追踪和验收协议。

### 阶段 6：竞赛演示与交付

- 完成至少四领域的单会话连续自动路由演示。
- 统计路由准确率、任务完成率、延迟、失败回退和引用完整性。
- 展示 Router 选择理由、子智能体、工具、模型、耗时和来源，且日志不泄露凭据。
- 完成 Ubuntu 22.04 / MTT AIBOOK AIOS 1.4.2 安装、服务管理和打包验证。

## 完成标准

- 用户无需手动指定 Subagent，Function Router 能自动选择或编排。
- 三个 Subagent 均解决完整业务问题，而不是 API 的别名包装。
- Subagent 的工具和 Skill 由 pi-agent 执行，权限与用户确认没有旁路。
- 最终回答模型来自当前智能体配置，Router 模型与回答模型职责分离。
- Staix 正常保存会话、附件、工作区、主/子任务关系和执行历史。
- `functions.jsonl`、同名 wrapper 和 OpenAI-compatible 接口保持有效。
- 演示和审计能够证明请求真实经过 MTClaw，而非只显示 Router 开关或标签。

## 当前状态

- 已保留 Staix 产品层和 RpcAgentAdapter/pi-agent 主运行链。
- 已接通 MTClaw OpenAI-compatible Provider、Router 开关、健康检查和 Smoke Tool。
- Smoke Tool 只证明基础路由链，不代表专业 Subagent 已完成。
- Staix 子智能体目前仍以配置和提示上下文为主，真实自动调度与隔离执行待实现。
- 三个专业 Subagent、四领域连续演示和 Ubuntu/AIOS 交付待完成。
