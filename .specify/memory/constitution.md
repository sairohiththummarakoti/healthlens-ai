# HealthLens AI Constitution

## Core Principles

### I. Evidence Before Explanation
All analytical findings MUST be calculated by deterministic logic and verified against
original observations before explanation. Evidence MUST retain source identifiers, dates,
original values and units. Failed verification MUST never be labeled verified.

### II. Informational Health Understanding
The product MUST explain recorded changes without diagnosis, prescriptions, predictions of
certain disease, or instructions to stop medication. Every explanation view MUST show the
required informational-prototype disclaimer. Direction is not clinical improvement or decline.

### III. Honest Agent Transparency
Four distinct components MUST perform history retrieval, trend calculation, evidence
verification, and explanation. Logs MUST reflect actual execution and failures. Template
explanations MUST be labeled. LLM availability and dataset provenance MUST be visible;
synthetic fixtures MUST never be presented as downloaded records.

### IV. Reproducible and Private by Default
The demonstration MUST use anonymous synthetic records. Uploads MUST be validated and bounded.
Secrets, uploads, databases, and caches MUST stay out of version control. The local prototype
MUST bind to loopback by default and MUST not claim production privacy compliance. External
LLMs receive only the minimum verified information with an explicitly configured provider.

### V. Test the Trust Boundary
Tests MUST cover arithmetic, zero baselines, insufficient data, incompatible units,
verification failure, invalid uploads, conversational evidence, and safety refusals.
PAT-001 LDL values 105, 118, 132 MUST pass an end-to-end demonstration. Responsive, keyboard
usable behavior MUST be checked in a browser before handoff.

## MVP Scope and Constraints

Include sample selection, CSV/JSON upload, four-agent execution, dashboard, charts, evidence,
grounded questions, source attribution, and local launch instructions. PDF ingestion, model
training, diagnosis, EHR integration, wearables, production authentication, and HIPAA
infrastructure are outside version 1. Hugging Face supplies data; Codex is a development tool.
Runtime credentials require a user-selected provider and secure configuration.

## Development Workflow and Quality Gates

Use Spec Kit constitution, specify, plan, tasks, implement, and converge in order. Maintain
requirements under specs/001-health-history. Complete dependency-ordered tasks, test behavior,
review results, and record limitations honestly. Publish reviewed source, synthetic fixtures,
configuration examples, and reproducible instructions.

## Governance

Amendments MUST state their rationale and update affected specifications. Use major versions
for incompatible principles, minor for additions, patch for clarifications. Implementation and
convergence MUST check every principle; unresolved violations block a claim of completion.

**Version**: 1.0.0 | **Ratified**: 2026-09-24 | **Last Amended**: 2026-09-24
