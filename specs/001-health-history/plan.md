# Implementation Plan: HealthLens AI
**Branch**: `main` | **Date**: 2026-09-24 | **Spec**: [spec.md](spec.md)

## Summary
Implement a local React dashboard and FastAPI service. Four distinct Python agents produce
deterministic verified findings before language output. Bundle synthetic acceptance fixtures.
Expose structured REST endpoints and persist local records/analyses in SQLite. Support separate
Hugging Face ingestion with explicit provenance. Provider integration waits for the user's choice.

## Technical Context
**Language/Version**: Python >=3.11 and TypeScript on Node >=22.
**Primary Dependencies**: FastAPI, Uvicorn, Pydantic; React, Vite, lucide-react, Recharts.
**Storage**: SQLite under ignored data/, raw source observations preserved.
**Testing**: pytest for trust boundaries/API; Playwright for real user journeys.
**Target Platform**: Local Windows development; portable Docker build.
**Project Type**: Web application with backend API.
**Performance Goals**: Local deterministic analysis <10 seconds for demo; 10,000-row upload cap.
**Constraints**: 2 MB upload cap; loopback binding; no real PHI; no secrets in Git.
**Scale/Scope**: Single-user research MVP; three bundled patients, 18 metrics, 3 years.

## Constitution Check
- Evidence before explanation: separate normalization, analytics, verification and explanation modules.
- Informational: neutral direction labels, fixed disclaimer, unsafe request refusal.
- Honest transparency: actual timestamped stages; explicit deterministic/LLM mode.
- Privacy: local database, reset endpoint, bounded inputs, ignored secrets/data.
- Verification: unit/API tests plus browser flow. All gates pass by design; live provider pending.
Post-design: identical checks apply; no justified violations.

## Project Structure
### Documentation (this feature)
specs/001-health-history/{spec,plan,research,data-model,quickstart,tasks}.md and contracts/api.md.

### Source Code (repository root)
- backend/app/{main,models,store,agents,seed}.py
- backend/tests/test_healthlens.py
- frontend/src/{App,api,types}.tsx or .ts and styles.css
- scripts/import_huggingface.py
- tests/e2e/healthlens.spec.ts
- pyproject.toml, frontend/package.json, Dockerfile, .vscode/tasks.json

**Structure Decision**: Separate server/client with same-origin API in production, Vite proxy
during development. Native Python math and CSV avoid heavy data-science dependencies for small
uploads; SQLite supplies persistence. Browser graphs consume verified API results.

## Complexity Tracking
No constitution violations. Clinical thresholds, authentication, distributed jobs and vector
search are not needed for the MVP. LLM configuration remains an explicit external dependency.
