# Research and Decisions

## Toolchain
Decision: Spec Kit 1.0.11, official Codex integration, PowerShell scripts, VS Code.
Rationale: Installed Codex extension and Windows uv/Node toolchain verified locally.
Alternatives: Visual Studio IDE was not detected; no extra editor extension is needed.
Sources: https://github.github.io/spec-kit/installation.html and
https://github.github.io/spec-kit/reference/integrations.html

## Application structure
Decision: React/Vite/TypeScript, FastAPI/Pydantic, SQLite, Recharts.
Rationale: Matches the supplied React/Python preference; compact local services with typed input,
reproducible lockfiles, and charts. No existing application code constrains the design.
Alternatives: Streamlit is faster to scaffold but limits the intended dashboard experience;
pandas is unnecessary for bounded 10,000-record descriptive calculations.

## Data and verification
Decision: Versioned synthetic acceptance fixture with 18 measurements and 3 patients; separate
Hugging Face importer reads george-essam-ai/synthea-healthcare-dataset observations.parquet at
revision a960cceb488b7a56a7ffabfd9d84f827bc684a5c, verifying the published SHA-256.
Rationale: Fixed LDL fixture preserves acceptance independently of external data availability.
Validation: 172 observations from five anonymous patients across five source years were imported
through the API; all 50 findings verified. Each source row locator and revision is retained.
Alternatives: Instruction-only datasets do not support timelines; a 2.4GB archive is unnecessary.
Importer and downloaded data remain distinct. See docs/data-sources.md for sources and license.

## Language provider
Decision: Provider-independent orchestration with deterministic explanations visibly identified.
Credential decision is pending. No live provider code or API requests until that decision.
Rationale: User authorization to build does not supply credentials or select a billable account.
Alternatives: Hidden fallback or silently using unrelated credentials would misrepresent the demo.

## Analytics semantics
Decision: 1% adjacent-change descriptive tolerance, null percentage at zero, reversals classified
before endpoint direction, no clinical significance claims. Retain original observations alongside
normalized values and independently recompute claim arithmetic during verification.
Rationale: Handles repeated/irregular dates, mixed units, and traceability explicitly.

## Privacy and execution
Decision: Loopback only, local SQLite, bounded uploads, explicit local reset, no authentication.
Rationale: Appropriate for synthetic fellowship demonstration; production hosting is out of scope.
