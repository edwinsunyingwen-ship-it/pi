# Legal research Subagent end-to-end evidence

## Scope

- Verification date: 2026-08-05
- Path: Staix UI -> AgentService -> pi-agent parent runtime -> MTClaw Function Router -> legal research Subagent -> Staix capabilities
- Verification type: manual real-runtime acceptance
- Credential handling: no API keys or private configuration values are recorded in this evidence

## Professional delegation task

The parent agent was asked to delegate a complete legal-research objective without manually selecting the child agent. The objective required one current-law search, at least one related judicial case and disclosure of the tools actually used.

Observed result:

- Parent model: `volcengine/ep-20260711144344-4zm7g`
- Router decision: one `delegate_to_subagent` call with role `legal_research`
- Child agent: `法规与类案研究`
- Child model: `volcengine/ep-20260711144344-4zm7g`
- Statute tool: `yuandian_rh_ft_search`
- Case tool: `yuandian_case_vector_search`
- Both tool calls returned successful results
- The final answer included Civil Code Article 496 and one identified judgment
- End-to-end duration: 69 seconds
- Router session key: `019fcf39-0c2d-7658-a224-03583e4f9500`
- Router statuses at capture time: `delegated_tool_call`, followed by the legacy status name `qwen_completed`
- The public legacy status name was renamed to `routing_model_completed` and reverified on 2026-08-06
- Repeated delegation was not observed

## Repeat-delegation protection

The routing implementation now blocks a second `delegate_to_subagent` request when processing the continuation of an already delegated call. The focused regression tests passed, and the complete MTClaw suite passed with 78 tests.

## Router trace presentation

A separate short request verified correlation between the Staix desktop session and the Router's internal pi-agent session identifier.

Observed result:

- User-visible answer: `最终追踪通过`
- Duration: 4 seconds
- Staix displayed `MTClaw 路由追踪`
- Displayed routing model: `ep-m-20260523165124-pq294`
- Displayed answer model: `ep-20260711144344-4zm7g`
- Router status: `forwarded_after_routing`
- Router session key: `019fd21e-7cf0-7399-95e1-20b8d6cfc5e1`
- The previous message stating that no corresponding Router trace was available did not appear

## Acceptance result

PASS for the legal research Subagent and Router trace presentation. This evidence does not cover the enterprise due-diligence or contract counterparty risk-review Subagents.
