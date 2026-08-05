# HICOOL source verification test report

## Verification metadata

- Verification date: 2026-08-05
- Branch: codex/hicool-mtclaw-provider
- Repository baseline: d7c59efe5f6376bc0d2d78f8a8d86d486d63429f
- MTClaw upstream commit: 861fe37a76a1c4a24fa9d29bfcef5956ef685ee3
- Linux test environment: Ubuntu 24.04.4 LTS on WSL2, Python 3.12.3
- Windows check environment: Node.js 24.15.0, npm 11.12.1

## Automated verification results

| Verification | Result | Evidence |
| --- | --- | --- |
| MTClaw Python suite | PASS: 78 passed, 4 deprecation warnings, 3.38 seconds | evidence/mtclaw-pytest-ubuntu-24.04-20260805.log |
| Repository quality gate | PASS: Biome, tsgo, Windows typecheck, browser smoke and web-ui checks | evidence/npm-check-windows-20260805.log |
| Legal research Subagent end to end | PASS: parent delegated once; child called one statute-search and one case-search tool; final answer returned in 69 seconds | evidence/legal-research-subagent-e2e-20260805.md |
| Router trace presentation | PASS: Staix correlated the pi-agent request with Router history and displayed both routing and answer model calls | evidence/legal-research-subagent-e2e-20260805.md |
| Linux shell modes | PASS: 12 expected scripts stored as executable | Git index mode check |
| Staging boundary | PASS: no output, private config, nested Git metadata, cache or bytecode staged | Git staging audit |
| High-risk credential scan | PASS: no recognized private-key or common cloud-token pattern found | Git index scan |
| Upstream delta | PASS: upstream files differ only at function_router/server.py; two provenance files added | relocated upstream Git metadata comparison |

## Evidence integrity

- mtclaw-pytest-ubuntu-24.04-20260805.log SHA256: C1CCA9954FA95F200245BCAE8CE4530005DCD2A3DEB89676CE5AB7FE505F5106
- npm-check-windows-20260805.log SHA256: 617977ADEE09DC8394E98C29DF1E820528BEDC84818DE419FDFF421460AA8F18
- legal-research-subagent-e2e-20260805.md SHA256: 2054C21C675636637216A271F75B61AE41413E0CCFBABA28DC805D9CCFC3D5E5

## Warnings and remaining risks

1. Exact Ubuntu 22.04 validation is not complete. The local Ubuntu-22.04 WSL instance entered Wsl/Service/E_UNEXPECTED with a read-only temporary filesystem.
2. MTT AIBOOK AIOS 1.4.2 hardware validation is not complete.
3. The legal research Subagent has passed one real end-to-end task. The enterprise due-diligence and contract counterparty risk-review Subagents have not yet passed equivalent acceptance tasks.
4. A repeat-delegation guard is covered by regression tests, but broader multi-task stress testing has not yet been completed.
5. Aggregate tool success rate, latency distribution, ClawBench and PinchBench-core evidence is not yet available.
6. FastAPI reports four on_event deprecation warnings. They do not fail the current suite but should be tracked.
7. Windows execution produced Linux-shell compatibility failures; Windows is development-only and is not the deployment acceptance environment.

## Required acceptance gates before submission

- Re-run the same 78-test MTClaw suite on Ubuntu 22.04 or the competition AIBOOK.
- Capture one complete correlated trace for each of the two remaining Subagents.
- Record success rate, tool latency, end-to-end latency and raw task logs.
- Run required competition benchmarks and preserve raw outputs.
- Perform an offline cold-start installation test from the final source package.
- Freeze source, demo video, test report and checksums only after all gates pass.
