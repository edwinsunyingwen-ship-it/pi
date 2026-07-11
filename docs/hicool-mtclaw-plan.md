# HICOOL MTClaw 法律智能工作站规划

## 项目边界

- 工作目录为 `D:\codexProject\staix-mtclaw`。
- `D:\codexProject\New project` 是原 staix 项目，不得修改。
- 复用 staix 的桌面 UI、会话、附件、工作区、设置和审计能力。
- 比赛主链路必须是：`staix UI -> Electron AgentService -> MTClaw Function Router -> Legal Subagents`。
- Windows 仅用于开发；MTClaw、Subagent 服务、部署和打包以 Ubuntu 22.04 / MTT AIBOOK AIOS 1.4.2 为准。

## Tool、Skill 与 Subagent

- Tool：单一、确定性的原子能力，例如音频转写、OCR、企查查查询、法规检索、案例检索、DOCX/PDF 渲染。
- Skill：描述如何组合工具和执行专业流程的规则、模板与检查清单。
- Subagent：面向用户目标完成一整套流程，管理中间状态、调用多个工具、校验结果并输出可交付成果。

比赛交付不能只把若干 API 包装成 Tool。每个参赛 Subagent 都应解决一个真实律师业务问题，并产生独立、可验证的业务成果。

## 法律 Subagents

### 1. `legal_case_intake`

输入案件录音、聊天记录、PDF、Word、图片和其他材料，完成：

- 音频转写和说话人区分；
- OCR 与文档正文提取；
- 人物、主体、时间、金额、行为和争议焦点抽取；
- 证据目录和待核实事项；
- 案件时间线、主体关系图和案情梳理文档。

输出必须区分原始事实、模型推断和待核实内容，并保留材料定位信息。

### 2. `legal_research`

围绕争议焦点调用法规库、案例库和企业信息接口，完成：

- 检索式生成与迭代；
- 法律法规、司法解释和类案检索；
- 企业主体、股权和风险信息查询；
- 来源去重、有效性与时效性标记；
- 类案检索报告和引用清单。

企查查能力通过受控适配器接入。开发前必须确认账号授权、API/CLI 形态、调用限制和展示许可，不在代码中写死凭据。

### 3. `contract_review`

输入合同及审查立场，完成：

- 合同类型和交易结构识别；
- 条款拆分、缺失条款和冲突检查；
- 法律、履约、商业和格式风险分级；
- 原文定位、修改建议和建议条款；
- 审查报告及可选修订稿。

所有结论必须可回溯到合同原文；未提供审查立场时应明确默认假设。

### 4. `legal_work_product`

基于案件事实、研究结果和律师选择生成：

- 案情摘要、会议纪要和客户沟通稿；
- 诉讼策略备忘录草稿；
- 律师工作报告；
- DOCX、PDF、时间线和关系图等可视化交付物。

该 Subagent 不得把未经确认的推断写成确定事实。

## 原子工具

首批工具建议：

- `transcribe_audio`
- `extract_document_text`
- `ocr_document`
- `query_enterprise_registry`
- `search_statutes`
- `search_cases`
- `analyze_contract_clauses`
- `render_legal_report`
- `render_case_timeline`
- `render_entity_graph`

每个工具在 MTClaw `functions.jsonl` 中定义 schema，并由同名 Ubuntu shell wrapper 执行。wrapper 从 stdin 读取 JSON，向 stdout 输出 JSON。

## 运行架构

```text
Staix React UI
  -> Electron preload / IPC
  -> AgentService
  -> MtclawAgentAdapter
  -> MTClaw /v1/chat/completions
  -> Function Router
       -> legal_case_intake
       -> legal_research
       -> contract_review
       -> legal_work_product
  -> tools and local services
```

staix 不是 OpenClaw 工具执行端，首期 MTClaw 配置使用 `delegate_tools_to_openclaw=false`。staix 会话 ID 通过请求 header 传入 MTClaw。

## 数据与安全

- 原始材料、转写、索引、中间产物和最终报告按案件目录隔离。
- API 密钥只允许来自环境变量或本机受控配置。
- 审计日志记录路由、工具、耗时和来源，但必须脱敏。
- 不向模型声明已经读取未实际解析的材料。
- 法律结论必须展示来源和生成时间；产品输出定位为律师辅助成果，由专业人员复核。
- 删除案件时应能同时清理原始材料、索引和派生文件。

## 开发阶段

1. 安装 WSL2 Ubuntu 22.04，并验证 Node、Python、bash 和 jq。
2. 在 WSL 中运行本地 MTClaw 原始服务及离线测试。
3. 新增 `MtclawAgentAdapter`，跑通纯文本、SSE、会话隔离、取消和错误处理。
4. 实现 `legal_case_intake` 的最小闭环：材料提取、案情时间线和报告。
5. 实现 `legal_research`，接入获授权的法规、案例和企业信息接口。
6. 实现 `contract_review` 与结构化风险报告。
7. 实现 `legal_work_product` 和 DOCX/PDF/可视化输出。
8. 增加 Router trace、延迟统计和错误回退展示。
9. 增加 Ubuntu 安装、服务管理和 Electron Linux 打包。
10. 在 MTT AIBOOK 完成四领域连续演示和离线/弱网演练。

## 第一阶段验收

- WSL2 中显示 Ubuntu 22.04 且版本为 WSL 2。
- MTClaw `/health` 与 `/ready` 可访问。
- 不依赖 Windows 路径运行 Function Router。
- 一个 staix 会话可以通过 MTClaw 获得流式回复。
- 两个会话的 Router 上下文严格隔离。
- 路由与工具执行失败会明确回传，不伪造成功结果。

