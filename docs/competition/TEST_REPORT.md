# HICOOL source verification test report

## Verification metadata

- Verification date: 2026-08-08
- Branch: codex/hicool-mtclaw-provider
- Repository baseline: 526682d9c2069f08171ca786a24020862a8a22c9
- MTClaw upstream commit: 861fe37a76a1c4a24fa9d29bfcef5956ef685ee3
- Linux test environment: Ubuntu 24.04.4 LTS on WSL2, Python 3.12.3
- Windows check environment: Node.js 24.15.0, npm 11.12.1

## Automated verification results

| Verification | Result | Evidence |
| --- | --- | --- |
| MTClaw Python suite | PASS: 78 passed, 4 deprecation warnings, 5.17 seconds | evidence/mtclaw-pytest-ubuntu-24.04-20260808.log |
| Repository quality gate | PASS: Biome, tsgo, Windows typecheck, browser smoke and web-ui checks | evidence/npm-check-windows-20260808.log |
| Legal research Subagent end to end | PASS: parent delegated once; child called one statute-search and one case-search tool; final answer returned in 69 seconds | evidence/legal-research-subagent-e2e-20260805.md |
| Enterprise due-diligence Subagent end to end | PASS: parent delegated once; child executed one qcc registration query without browser use; final answer returned in 32 seconds | evidence/enterprise-due-diligence-subagent-e2e-20260806.md |
| Civil litigation document Subagent end to end | PASS: four template mappings, image OCR, native DOCX extraction, preview-before-DOCX, confirmed DOCX output and long-request Router trace | evidence/civil-litigation-document-subagent-e2e-20260808.md |
| Router trace presentation | PASS: Staix correlated short and multiline delegated requests with Router history; public completion status is `routing_model_completed` | evidence/legal-research-subagent-e2e-20260805.md; evidence/enterprise-due-diligence-subagent-e2e-20260806.md; evidence/civil-litigation-document-subagent-e2e-20260808.md |
| Linux shell modes | PASS: 12 expected scripts stored as executable | Git index mode check |
| Staging boundary | PASS: no output, private config, nested Git metadata, cache or bytecode staged | Git staging audit |
| High-risk credential scan | PASS: no recognized private-key or common cloud-token pattern found | Git index scan |
| Upstream delta | PASS: upstream files differ only at function_router/server.py; two provenance files added | relocated upstream Git metadata comparison |

## Evidence integrity

- mtclaw-pytest-ubuntu-24.04-20260808.log SHA256: 5576EFC118049B2BBFC3231CF37A7573C357345513441879008056E186582331
- npm-check-windows-20260808.log SHA256: D32E0E60ACCC3369E003FA8B3BE1693FCF86B0C238F685CC2491C93C003A0AB4
- legal-research-subagent-e2e-20260805.md SHA256: 5C2C2D317A4F31A11E5C52789D142BDB72A096AE03484F58096B5A05DD031891
- enterprise-due-diligence-subagent-e2e-20260806.md SHA256: 02F7AEEC543D866E837506E5941AB17F1205E0632B831944F1E6FCBDF962CA8E
- civil-litigation-document-subagent-e2e-20260808.md SHA256: 962CD39C29DE1E8BA958C3F50916E51EE4917BECE9C53D78BCF45E395A61B4BC

## Warnings and remaining risks

1. Exact Ubuntu 22.04 validation is not complete. The local Ubuntu-22.04 WSL instance entered Wsl/Service/E_UNEXPECTED with a read-only temporary filesystem.
2. MTT AIBOOK AIOS 1.4.2 hardware validation is not complete.
3. The legal research, enterprise due-diligence and civil litigation document Subagents have passed real end-to-end tasks. The new native PDF reader has component-level coverage but has not been repeated through the Staix UI.
4. One enterprise child-model response stalled before tool invocation; an isolation check and immediate full retry passed. Retry, timeout and broader multi-task stress behaviour still require validation.
5. qcc CLI `1.0.7` is currently installed globally and authorized through a user-private configuration file. It is not yet bundled with the Staix installer or covered by an offline credential-bootstrap test.
6. A repeat-delegation guard is covered by regression tests, but broader multi-task stress testing has not yet been completed.
7. Aggregate tool success rate, latency distribution, ClawBench and PinchBench-core evidence is not yet available.
8. FastAPI reports four on_event deprecation warnings. They do not fail the current suite but should be tracked.
9. Windows execution produced Linux-shell compatibility failures; Windows is development-only and is not the deployment acceptance environment.
10. The final deterministic party-label enforcement passed local regression checks and the Windows build, but was not followed by another manual Staix UI run.

## Required acceptance gates before submission

- Re-run the same 78-test MTClaw suite on Ubuntu 22.04 or the competition AIBOOK.
- Repeat the native PDF reader and final party-label enforcement through the Staix UI on the target Linux/AIOS machine.
- Bundle and pin qcc CLI in the deliverable, then verify secure first-run authorization without embedding a credential in source or capability text.
- Record success rate, tool latency, end-to-end latency and raw task logs.
- Run required competition benchmarks and preserve raw outputs.
- Perform an offline cold-start installation test from the final source package.
- Freeze source, demo video, test report and checksums only after all gates pass.
