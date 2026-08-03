# Staix competition changes to MTClaw

## Source provenance

- Upstream: https://github.com/MooreThreads/MTClaw
- Commit: 861fe37a76a1c4a24fa9d29bfcef5956ef685ee3
- License: MIT
- Vendored on: 2026-08-03

MTClaw is vendored to make the competition source package self-contained.

## Required runtime path

Staix UI -> AgentService API -> pi-agent parent runtime -> MTClaw Function Router -> Subagent runtime.

## Local modifications

Only function_router/server.py differs from the recorded upstream commit.

- Preserve the requested model when configured.
- Read the upstream.use_request_model option.
- Forward session correlation headers.
- Keep upstream proxy timing information.
- Preserve the MTClaw OpenAI-compatible API contract.
