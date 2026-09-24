# Tasks: HealthLens AI

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/api.md.
**Tests**: Required by the constitution for calculations, trust boundaries and end-to-end behavior.

## Phase 1: Setup
- [X] T001 Create dependency/build configuration in pyproject.toml and frontend/package.json.
- [X] T002 [P] Configure ignores, local VS Code tasks and project guidance in .gitignore, .vscode/tasks.json and AGENTS.md.

## Phase 2: Foundation
- [X] T003 Create validated models and SQLite storage in backend/app/models.py and store.py; finite numeric values, date validation, patient IDs 1–80 characters.
- [X] T004 [P] Create shared frontend API types/client and application entry in frontend/src/types.ts, api.ts and main.tsx using contracts/api.md.

## Phase 3: US1 — Verified health story
**Independent test**: PAT-001 analysis, LDL 105 → 118 → 132, +25.7%, original evidence.
- [X] T005 [P] [US1] Write arithmetic, normalization, verification-failure and API tests in backend/tests/test_healthlens.py before implementation.
- [X] T006 [US1] Implement 3 synthetic patients with 18 metrics and provenance in backend/app/seed.py.
- [X] T007 [US1] Implement four distinct deterministic agents, actual status log and verification in backend/app/agents.py.
- [X] T008 [US1] Expose patient, analysis, trend and evidence endpoints in backend/app/main.py.
- [X] T009 [P] [US1] Build responsive home, selection, processing, chart and evidence views in frontend/src/App.tsx and styles.css.

## Phase 4: US2 — Grounded conversation
**Independent test**: Largest-change question followed by evidence request uses same metric.
- [X] T010 [US2] Add routed intent, scoped prior references, refusals and tests in backend/app/agents.py and backend/tests/test_healthlens.py.
- [X] T011 [P] [US2] Add prompt chips, conversational history, evidence links and agent details in frontend/src/App.tsx.
- [ ] T012 [US2] Connect the selected language provider in backend/app/explanation.py after secure credential choice; record unavailable mode honestly.

## Phase 5: US3 — Structured uploads
**Independent test**: CSV/JSON equivalents analyze identically; malformed uploads save nothing.
- [X] T013 [US3] Implement transactional CSV/JSON validation, 2 MB and 10,000-row caps, example CSV and reset in backend/app/main.py and store.py.
- [X] T014 [P] [US3] Implement accessible upload dialog, schema help and reset flow in frontend/src/App.tsx.
- [X] T015 [P] [US3] Verify a synthetic Hugging Face source and add provenance-preserving importer in scripts/import_huggingface.py and docs/data-sources.md.

## Phase 6: Polish and convergence
- [X] T016 [P] Add reproducible local/Docker instructions and editor handoff in README.md, Dockerfile, .dockerignore and .vscode/tasks.json.
- [X] T017 Add and run browser journeys in tests/e2e/healthlens.spec.ts; run backend tests and production build.
- [X] T018 Review requirement coverage and record evidence/remaining work in specs/001-health-history/convergence.md.
- [X] T019 Commit reviewed source/specs and push main to the private GitHub repository; verify remote SHA.

## Dependencies & Execution Order
T001–T002 precede foundation. Backend T003 and frontend T004 can proceed in parallel.
US1 backend T005–T008 depends on T003; UI T009 depends on T004 and the stable API contract.
US2/US3 extend these foundations. T012 is gated only by the provider decision, so independent
analytics, UI and ingestion work continues. T015 uses separate scripts/docs. T017 integrates all
available features. T018 must report missing provider verification instead of claiming convergence.

## Parallel Examples
US1: backend analytics/API and frontend chart/evidence layout use disjoint files.
US2: backend routing and frontend conversation share only the documented API contract.
US3: backend upload parser, frontend upload dialog and dataset importer use separate files.

## Implementation Strategy
Complete deterministic PAT-001 flow first, then routed questions and uploads. Integrate the
selected provider after its setup decision. Run Spec Kit convergence and remedy remaining gaps.

## Phase 7: Convergence
- [ ] T020 Complete and verify the runtime language-provider integration in backend/app/explanation.py after the user's secure provider/credential choice; send only verified evidence, reject unsupported numerical claims, test unavailable-provider fallback and safety, and measure the configured-AI latency per FR-011, SC-001, US2/AC4 and T012 (partial).
