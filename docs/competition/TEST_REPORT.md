# HICOOL source verification test report

## Verification metadata

- Verification date: 2026-08-06
- Branch: codex/hicool-mtclaw-provider
- Repository baseline: 96283a5f60c0f358ce31a380aa807c9feeb19f78
- MTClaw upstream commit: 861fe37a76a1c4a24fa9d29bfcef5956ef685ee3
- Linux test environment: Ubuntu 24.04.4 LTS on WSL2, Python 3.12.3
- Windows check environment: Node.js 24.15.0, npm 11.12.1

## Automated verification results

| Verification | Result | Evidence |
| --- | --- | --- |
| MTClaw Python suite | PASS: 78 passed, 4 deprecation warnings, 3.78 seconds | evidence/mtclaw-pytest-ubuntu-24.04-20260806.log |
| Repository quality gate | PASS: Biome, tsgo, Windows typecheck, browser smoke and web-ui checks | evidence/npm-check-windows-20260806.log |
| Legal research Subagent end to end | PASS: parent delegated once; child called one statute-search and one case-search tool; final answer returned in 69 seconds | evidence/legal-research-subagent-e2e-20260805.md |
| Enterprise due-diligence Subagent end to end | PASS: parent delegated once; child executed one qcc registration query without browser use; final answer returned in 32 seconds | evidence/enterprise-due-diligence-subagent-e2e-20260806.md |
| Router trace presentation | PASS: Staix correlated both short and multiline delegated requests with Router history; public completion status is `routing_model_completed` | evidence/legal-research-subagent-e2e-20260805.md; evidence/enterprise-due-diligence-subagent-e2e-20260806.md |
| Linux shell modes | PASS: 12 expected scripts stored as executable | Git index mode check |
| Staging boundary | PASS: no output, private config, nested Git metadata, cache or bytecode staged | Git staging audit |
| High-risk credential scan | PASS: no recognized private-key or common cloud-token pattern found | Git index scan |
| Upstream delta | PASS: upstream files differ only at function_router/server.py; two provenance files added | relocated upstream Git metadata comparison |

## Evidence integrity

- mtclaw-pytest-ubuntu-24.04-20260806.log SHA256: 68F6723E086B6B887A2728EE489AB8C50B7CD7880333F7300BB79EFE25FA8233
- npm-check-windows-20260806.log SHA256: AA8C1DF39CFDA78EF0C3C9C3D3F61F35EC87D1A2641123CA76C301117678C116
- legal-research-subagent-e2e-20260805.md SHA256: 5C2C2D317A4F31A11E5C52789D142BDB72A096AE03484F58096B5A05DD031891
- enterprise-due-diligence-subagent-e2e-20260806.md SHA256: 02F7AEEC543D866E837506E5941AB17F1205E0632B831944F1E6FCBDF962CA8E

## Warnings and remaining risks

1. Exact Ubuntu 22.04 validation is not complete. The local Ubuntu-22.04 WSL instance entered Wsl/Service/E_UNEXPECTED with a read-only temporary filesystem.
2. MTT AIBOOK AIOS 1.4.2 hardware validation is not complete.
3. The legal research and enterprise due-diligence Subagents have passed real end-to-end tasks. The contract counterparty risk-review Subagent has not yet passed equivalent acceptance testing.
4. One enterprise child-model response stalled before tool invocation; an isolation check and immediate full retry passed. Retry, timeout and broader multi-task stress behaviour still require validation.
5. qcc CLI `1.0.7` is currently installed globally and authorized through a user-private configuration file. It is not yet bundled with the Staix installer or covered by an offline credential-bootstrap test.
6. A repeat-delegation guard is covered by regression tests, but broader multi-task stress testing has not yet been completed.
7. Aggregate tool success rate, latency distribution, ClawBench and PinchBench-core evidence is not yet available.
8. FastAPI reports four on_event deprecation warnings. They do not fail the current suite but should be tracked.
9. Windows execution produced Linux-shell compatibility failures; Windows is development-only and is not the deployment acceptance environment.

## Required acceptance gates before submission

- Re-run the same 78-test MTClaw suite on Ubuntu 22.04 or the competition AIBOOK.
- Capture one complete correlated trace for the remaining contract counterparty risk-review Subagent.
- Bundle and pin qcc CLI in the deliverable, then verify secure first-run authorization without embedding a credential in source or capability text.
- Record success rate, tool latency, end-to-end latency and raw task logs.
- Run required competition benchmarks and preserve raw outputs.
- Perform an offline cold-start installation test from the final source package.
- Freeze source, demo video, test report and checksums only after all gates pass.
