# Civil litigation document Subagent end-to-end evidence

## Scope

- Verification dates: 2026-08-07 to 2026-08-08
- Path: Staix UI -> AgentService -> pi-agent parent runtime -> MTClaw Function Router -> civil litigation document Subagent -> deterministic material extraction/OCR -> fixed-template document generator
- Verification type: manual real-runtime acceptance plus local deterministic component checks
- Credential handling: no OCR credentials, API keys, bearer tokens or private configuration values are recorded in this evidence

## Fixed-template coverage

The four configured template identifiers were exercised through the delegated child runtime:

- `civil_complaint_natural_person`: image material was read with `ocr_text_extract`, previewed, confirmed and written as a DOCX test draft
- `civil_complaint_legal_entity`: supplied text and native DOCX material selected the legal-entity complaint template
- `civil_defense_natural_person`: supplied text and text-based PDF material selected the natural-person defense template
- `civil_defense_legal_entity`: supplied text selected the legal-entity defense template

Unknown court, contact, evidence, copy-count and signature-date values remained explicit pending fields. DOCX creation required a preview followed by explicit confirmation.

## Native DOCX end-to-end task

The parent agent was asked to delegate a native DOCX case-material task without manually selecting a child agent. The child was required to use the deterministic material reader first and was prohibited from using bash, pandoc, Python, pdftotext or OCR.

Observed result:

- Parent model: `volcengine/ep-20260711144344-4zm7g`
- Router decision: one `delegate_to_subagent` call with role `civil_litigation_document_generation`
- Child agent: `民事诉讼文书生成`
- Child model: `volcengine/ep-20260711144344-4zm7g`
- Input file type: native DOCX
- Child tools: `extract_civil_case_material`, followed by `generate_civil_litigation_document`
- OCR use: none
- Shell/toolchain fallbacks: none
- Selected template: `civil_complaint_legal_entity`
- Extracted fictional parties: `星河智能科技有限公司` and `远航数字服务有限公司`
- Extracted fictional amount: RMB 180000
- Output mode: `preview`
- Confirmation flag: `false`
- End-to-end duration: 69 seconds
- Task ID: `512c1acb-3db9-48a7-b752-2b61c4b5c92d`
- Child session ID: `4fc8d806-9305-478a-abd9-a9c777f08f2d`
- Router session key: `019fdcf5-1ec4-75d3-95ca-6292e65a5f9c`
- Router statuses: `delegated_tool_call`, followed by `routing_model_completed`
- Staix displayed the correlated MTClaw Router trace instead of the missing-trace message

This task replaced an earlier failed DOCX attempt in which shell output was mojibake and the model invented different party names and facts. The deterministic reader prevents that fallback path for supported files.

## Deterministic input-reader checks

Two fictional fixtures outside the repository were generated for input validation:

- `法人起诉案件材料-文本型.docx`
- `自然人应诉案件材料-文本型.pdf`

Direct component checks produced:

- `DOCX_FILE_TYPE=docx`
- `DOCX_NEEDS_OCR=false`
- `DOCX_KEY_FACTS=PASS`
- `PDF_FILE_TYPE=pdf`
- `PDF_NEEDS_OCR=false`
- `PDF_PAGE_COUNT=1`
- `PDF_KEY_FACTS=PASS`

The PDF check confirmed the fictional respondent `周明`, repayment amount `30000元` and case number after ignoring layout whitespace. A prior child-runtime PDF task also selected `civil_defense_natural_person` and produced a correct preview, but that earlier run used pdftotext before the deterministic reader was added. The new PDF reader has therefore passed component-level validation, not a repeated Staix UI end-to-end run.

## Generator invariants

The document generator enforces these runtime invariants:

- only four fixed complaint/defense and natural-person/legal-entity templates are accepted
- DOCX output requires `confirmed=true` and a selected workspace
- generated files stay under the workspace `generated-documents` directory
- unknown required values remain `[待补充：...]`
- the first party lines receive deterministic `原告：`, `被告：` or `答辩人：` labels when the model omits them
- existing party labels are not duplicated

Local regression output after the final label enforcement change:

- `COMPLAINT_PARTY_LABELS=PASS`
- `DEFENSE_PARTY_LABELS=PASS`

The final label enforcement change passed the repository quality gate and Windows production build. It was not followed by another manual Staix UI run.

## Automated regression result

- MTClaw suite: 78 passed, 4 existing FastAPI deprecation warnings
- Repository quality gate: Biome, tsgo, Windows typecheck, browser smoke and web-ui checks passed
- Windows production build: passed

## Acceptance result

PASS for the core civil litigation document Subagent path, all four template mappings, image OCR selection, native DOCX extraction, preview-before-DOCX enforcement, confirmed DOCX creation and correlated MTClaw trace presentation.

Remaining acceptance boundary: repeat the new native PDF reader through the Staix UI on the target Linux/AIOS machine, and run the final label-enforcement build once through the UI if a submission screenshot of the corrected labels is required.
