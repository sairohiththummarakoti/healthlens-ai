# HealthLens AI

Use the installed Spec Kit skills in `.agents/skills` for specification, planning, tasks,
implementation and convergence. Read `.specify/memory/constitution.md` and
`specs/001-health-history/` before changing behavior.

Backend: Python/FastAPI in backend/app. Frontend: React/TypeScript in frontend/src.
Keep deterministic arithmetic and source verification separate from language generation.
Never label template output as an LLM result. Never make diagnostic or treatment claims.
Use synthetic data only, preserve provenance and never commit secrets or local patient storage.

Checks: `uv run pytest backend/tests`; `npm --prefix frontend run build`;
browser tests from tests/e2e. Application binds to loopback during local development.
