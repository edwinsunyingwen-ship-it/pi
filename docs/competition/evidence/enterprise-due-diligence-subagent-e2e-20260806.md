# Enterprise due-diligence Subagent end-to-end evidence

## Scope

- Verification date: 2026-08-06
- Path: Staix UI -> AgentService -> pi-agent parent runtime -> MTClaw Function Router -> enterprise due-diligence Subagent -> qcc CLI
- Verification type: manual real-runtime acceptance
- Credential handling: no API keys, bearer tokens or private configuration values are recorded in this evidence

## Runtime prerequisites

- qcc CLI version: `1.0.7`
- qcc executable resolved from the current Windows user environment
- qcc configuration: `C:\Users\TRS\.qcc\config.json`
- qcc service base URL: `https://agent.qcc.com/mcp`
- `qcc check` reported authorization as configured without exposing the credential

The qcc CLI is currently an external runtime prerequisite. It is not yet bundled with the Staix installer.

## Model isolation check

Before the business-tool retry, the parent was asked to delegate a no-tool response to the enterprise due-diligence Subagent.

Observed result:

- Parent called `delegate_to_subagent` once with role `enterprise_due_diligence`
- Child agent: `企业主体核验与风险尽调`
- Child returned `企业子智能体模型正常` without calling a tool
- End-to-end duration: 11 seconds
- Staix displayed the correlated MTClaw Router trace
- Router statuses: `delegated_tool_call`, followed by `routing_model_completed`
- Router session key: `019fd465-8c43-7590-8d23-2bc3ae4b624d`

## Professional delegation task

The parent agent was asked to delegate a complete company-registration query without manually selecting the child agent. The child was constrained to the enterprise-information CLI and was explicitly prohibited from using the browser.

Observed result:

- Parent model: `volcengine/ep-20260711144344-4zm7g`
- Router decision: one `delegate_to_subagent` call with role `enterprise_due_diligence`
- Child agent: `企业主体核验与风险尽调`
- Child model: `volcengine/ep-20260711144344-4zm7g`
- Child runtime tool: `bash`
- Executed command: `qcc company get_company_registration_info --json "企查查科技股份有限公司"`
- Browser use: none
- qcc returned successful structured company-registration data
- The final answer included the company name, unified social credit code, legal representative, registration status, incorporation date, registered capital and registered address
- End-to-end duration: 32 seconds
- Router statuses: `delegated_tool_call`, followed by `routing_model_completed`
- Router session key: `019fd467-ac37-72cc-8896-c3f984e4880a`
- Staix displayed `MTClaw 路由追踪` instead of the previous missing-trace message
- Repeated delegation was not observed

## Stability observation

The first business-task attempt stalled while the child model was generating its initial response, before any `bash` or qcc tool call. The task was cancelled manually. A no-tool model isolation check then passed, and the complete qcc task passed on the next attempt. This indicates a transient model-response failure rather than a missing CLI or credential. Retry and timeout behaviour still require broader stress testing.

## Acceptance result

PASS for the enterprise due-diligence Subagent, qcc CLI invocation, MTClaw professional delegation and Router trace presentation. This evidence does not cover installer bundling, offline credential bootstrap or the contract counterparty risk-review Subagent.
