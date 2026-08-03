# HICOOL source verification test report

## Verification metadata

- Verification date: 2026-08-03
- Branch: codex/hicool-mtclaw-provider
- Repository baseline: c4b7db18faf6d0a229c07eac451f838be550c113
- MTClaw upstream commit: 861fe37a76a1c4a24fa9d29bfcef5956ef685ee3
- Linux test environment: Ubuntu 24.04.4 LTS on WSL2, Python 3.12.3
- Windows check environment: Node.js 24.15.0, npm 11.12.1

## Automated verification results

| Verification | Result | Evidence |
| --- | --- | --- |
| MTClaw Python suite | PASS: 76 passed, 4 deprecation warnings, 2.95 seconds | evidence/mtclaw-pytest-ubuntu-24.04-20260803.log |
| Repository quality gate | PASS: Biome, tsgo, Windows typecheck, browser smoke and web-ui checks | evidence/npm-check-windows-20260803.log |
| Linux shell modes | PASS: 12 expected scripts stored as executable | Git index mode check |
| Staging boundary | PASS: no output, private config, nested Git metadata, cache or bytecode staged | Git staging audit |
| High-risk credential scan | PASS: no recognized private-key or common cloud-token pattern found | Git index scan |
| Upstream delta | PASS: upstream files differ only at function_router/server.py; two provenance files added | relocated upstream Git metadata comparison |

## Evidence integrity

- mtclaw-pytest-ubuntu-24.04-20260803.log SHA256: 8C5F8B5B802515D2CE541BA5235C09E71BA3F5AC3322A1BFBA5C044659879672
- npm-check-windows-20260803.log SHA256: A0862CC3C45B9EF1115AC6EF3F61FC1891D1BBDF2DCBECDAE2A2883C445810FA

## Warnings and remaining risks

1. Exact Ubuntu 22.04 validation is not complete. The local Ubuntu-22.04 WSL instance entered Wsl/Service/E_UNEXPECTED with a read-only temporary filesystem.
2. MTT AIBOOK AIOS 1.4.2 hardware validation is not complete.
3. Real Staix UI -> AgentService -> pi-agent parent -> MTClaw Function Router -> Subagent execution has not yet been accepted end to end.
4. Three competition Subagents have not yet all been configured and verified with real tasks.
5. Real tool success rate, end-to-end latency, ClawBench and PinchBench-core evidence is not yet available.
6. FastAPI reports four on_event deprecation warnings. They do not fail the current suite but should be tracked.
7. Windows execution produced Linux-shell compatibility failures; Windows is development-only and is not the deployment acceptance environment.

## Required acceptance gates before submission

- Re-run the same 76-test MTClaw suite on Ubuntu 22.04 or the competition AIBOOK.
- Capture one complete correlated trace for each of the three Subagents.
- Record success rate, tool latency, end-to-end latency and raw task logs.
- Run required competition benchmarks and preserve raw outputs.
- Perform an offline cold-start installation test from the final source package.
- Freeze source, demo video, test report and checksums only after all gates pass.
