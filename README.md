# HealthLens AI

Understand how recorded health measurements change over time, with calculations you can trace
back to source records. A local fellowship/research prototype built with GitHub Spec Kit.

## Local development

Requirements: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 22+ and npm.

```powershell
uv sync --extra dev
npm --prefix frontend ci
uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
npm --prefix frontend run dev -- --host 127.0.0.1
```

Open http://127.0.0.1:5173. In VS Code, **Terminal → Run Task → HealthLens: Start all**
starts both services. **HealthLens: Test backend** and **HealthLens: Build web** run checks.

## Spec Kit in VS Code

Spec Kit 1.0.11 is installed for this Windows user; its official Codex skills live in
`.agents/skills`. Open this folder in VS Code and use the existing Codex extension. Invoke
`$speckit-constitution`, `$speckit-specify`, `$speckit-plan`, `$speckit-tasks`,
`$speckit-implement`, or `$speckit-converge` in the Codex chat. A new extension session may be
needed to discover newly installed skills.

The active feature lives in [specs/001-health-history](specs/001-health-history). The
[constitution](.specify/memory/constitution.md) governs verification, transparency and safety.
For another machine: install the CLI from the official release and use the already committed
project skills. `.specify/feature.json` is a per-machine feature pointer and is ignored by Spec Kit.

## Demonstration

1. Explore the synthetic patients and select PAT-001 (2024–2026).
2. Analyze its records and inspect the four agents' actual execution log.
3. Select LDL: **105 → 118 → 132 mg/dL**, **+27**, **+25.7%**.
4. Open evidence to inspect the original dated observations.
5. Ask **What changed the most?**, then **Show me why you said that.**
6. Download the example CSV or upload synthetic CSV/JSON records.

Calculations are descriptive. A rising or falling value is not automatically better or worse.
Percentage ranking across measurements is not a ranking of medical importance.

## Data, language and limitations

Bundled patients are synthetic fixtures authored for the demonstration. They are not patient
data downloaded from Hugging Face. See [data source documentation](docs/data-sources.md) for
the separate public synthetic dataset importer and its provenance.

The currently configured explanation mode is **deterministic**. Natural-language API setup
awaits the user's provider/credential choice. Template output is labeled and never presented
as a live LLM result. No runtime secret is committed.

Uploads and analyses stay in the local SQLite database under ignored `data/`. Use the app's
reset action to remove local uploads and analyses. Upload only synthetic/de-identified
demonstration data: this single-user prototype has no authentication or production privacy
infrastructure. Do not expose its API to a public network.

HealthLens AI is an informational prototype and does not provide medical diagnosis or treatment
advice. Discuss health concerns with a qualified healthcare professional.

## Validation

```powershell
uv run pytest backend/tests
npm --prefix frontend run build
npm --prefix frontend run test:e2e
```

Browser tests use installed Microsoft Edge and require both development servers above.
The feature quickstart and convergence report record validation and remaining work.

## One-service production-style preview

Build the frontend, then start the API; it serves `frontend/dist` when present:

```powershell
npm --prefix frontend run build
uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Or build/run the Docker image (Docker required):

```powershell
docker build -t healthlens-ai .
docker run --rm -p 127.0.0.1:8000:8000 healthlens-ai
```

Open http://127.0.0.1:8000. Container storage is ephemeral unless a data volume is supplied.
