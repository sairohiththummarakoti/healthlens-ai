# Quickstart validation

Prerequisites: Python >=3.11, uv, Node >=22, npm. Windows uses PowerShell.

1. `uv sync --extra dev`
2. `npm --prefix frontend install`
3. `uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`
4. In another terminal: `npm --prefix frontend run dev -- --host 127.0.0.1`
5. Open http://127.0.0.1:5173 and select PAT-001.
6. Analyze, inspect LDL 105 → 118 → 132, +25.7%, and source evidence.
7. Ask “What changed the most?” then “Show me why you said that.” Match cited evidence.
8. Upload the downloaded sample CSV and a JSON equivalent using **Upload and analyze**;
   each single-patient upload must automatically open results with four named completed agents.
   Test invalid-file feedback and multi-patient selection. Before analysis, Agent activity
   must show the same four components as **Not run**, without fabricated timestamps.
9. Run `uv run pytest backend/tests`, `npm --prefix frontend run build`, then browser tests.

Spec Kit is installed in `.agents/skills`. In Codex inside VS Code invoke
`$speckit-specify`, `$speckit-plan`, `$speckit-tasks`, `$speckit-implement`, `$speckit-converge`.
Read contracts/api.md and data-model.md for payload details. Runtime provider configuration is
separate from deterministic validation; never put credentials in chat or committed files.
