# MTClaw integration

This directory contains project-owned MTClaw configuration, Function Router schemas, same-name wrapper scripts, and trace integration.

The upstream MTClaw source is stored separately in `../MTClaw`. The different directory name is intentional because Windows paths are case-insensitive. Do not move Staix product or pi-agent runtime code into this directory.

## Architectural role

MTClaw is an OpenAI-compatible model Provider used by pi-agent. It does not replace pi-agent.

```text
Staix -> AgentService -> RpcAgentAdapter -> pi-agent
  -> normal mode: current agent answer model
  -> MTClaw mode: Function Router
       -> dedicated Router model
       -> professional Subagent/Workflow selected by Router
       -> real execution delegated to pi-agent child runtime
       -> current agent answer model produces the final response
```

Detailed architecture and execution flows are documented in:

- [`../docs/hicool-product-architecture.md`](../docs/hicool-product-architecture.md)
- [`../docs/hicool-subagent-contracts.md`](../docs/hicool-subagent-contracts.md)
- [`../docs/hicool-mtclaw-plan.md`](../docs/hicool-mtclaw-plan.md)

## Verified development configuration

- Function Router: `http://127.0.0.1:18790`
- OpenAI-compatible base URL: `http://127.0.0.1:18790/v1`
- Routing base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Routing model: `doubao-seed-2-0-mini-260428`
- Upstream base URL: `https://ark.cn-beijing.volces.com/api/v3`
- Example upstream model endpoint: `ep-20260711144344-4zm7g`
- Smoke execution remains available through `functions.smoke.jsonl` and `case_material_status.sh`.
- Professional execution uses `delegate_to_subagent`: MTClaw selects the stable role, then returns an OpenAI-compatible delegated tool call for the Staix pi-agent Runtime to execute.
- Secret source: `ARK_API_KEY` environment variable

Copy `config.example.json` to the ignored `config.local.json` for local development. Never put a real API key in a tracked file.

## Current status

The tracked `functions.jsonl` now exposes the generic professional delegation path:

```text
pi-agent -> MTClaw Provider -> Router model -> delegate_to_subagent -> pi-agent child Runtime -> configured capabilities -> Router continuation -> upstream answer model
```

The Windows client now registers the same `delegate_to_subagent` callable in the parent pi-agent Runtime. When MTClaw returns that delegated call, a localhost-authenticated bridge resolves the selected Staix child-agent configuration and starts an isolated pi-agent RPC process with its assigned model and capabilities.

The three stable Router-visible roles are:

- `enterprise_due_diligence`
- `legal_research`
- `contract_counterparty_risk_review`

Their actual contexts, models, capabilities, permissions and audit records remain owned by pi-agent and Staix. Real-provider acceptance, cancellation propagation, nested delegation and hierarchical UI display remain incomplete.

The old `case_material_status` smoke path remains available in `functions.smoke.jsonl`; it is not part of the professional Subagent implementation.

## Function and wrapper contract

- Keep one JSON object per line in `functions.jsonl`.
- Register only competition-specific professional Tools, Subagents, and Workflows.
- Do not repackage all Staix/pi-agent generic tools as MTClaw functions.
- Keep a same-name executable shell wrapper for each Router-executed function.
- Each wrapper reads JSON from stdin and writes one JSON result to stdout.
- Diagnostic output goes to stderr.
- Exit code `0` means protocol-level success; a non-zero exit code means failure.
- Wrappers must not store API keys or bypass pi-agent permissions.

The selected Router-to-pi mechanism is MTClaw standard delegated `tool_calls`. `delegate_tools_to_openclaw.tools` must include `delegate_to_subagent`. MTClaw makes the automatic routing decision; the matching pi-agent Runtime tool calls the authenticated Staix bridge, and Staix starts the real child Runtime. The same-name shell wrapper is a guard-only fallback and deliberately fails if MTClaw is accidentally configured for internal execution.

## Configuration ownership

| Configuration | Owner |
|---|---|
| Router model, Router endpoint, Router execution limits | MTClaw configuration |
| Current answer model | Staix current agent model configuration |
| Subagent model, prompt, Tool, MCP, Skill, knowledge | Staix agent configuration |
| QCC and other business credentials | Staix controlled capability/credential configuration |
| Route descriptions and stable Subagent delegation contract | MTClaw `functions.jsonl` |

Do not duplicate QCC, model, MCP, or browser credentials in `functions.jsonl` or wrapper scripts.

`delegate_to_subagent` appears in the OpenAI-compatible `tools` protocol because that is how MTClaw returns a callable delegation. Its business meaning is a Subagent task boundary. QCC commands, HTTP APIs, MCP tools, browser operations, file operations, and Shell commands remain tools dynamically assigned to the selected Staix child agent.

## Trace requirements

The production path must correlate:

- Staix main session ID
- pi-agent runtime session ID
- MTClaw session key
- Router decision and round
- Subagent task ID
- tool call IDs
- current answer model call ID

Logs must show the selected Subagent, tools, model, duration, source, error, and fallback without exposing Authorization headers, API keys, tokens, passwords, or secrets.

## Platform boundary

Windows and WSL are development environments. The delivery target is Ubuntu 22.04 on MTT AIBOOK AIOS 1.4.2. Wrapper scripts and service configuration must not rely on Windows-only paths.
