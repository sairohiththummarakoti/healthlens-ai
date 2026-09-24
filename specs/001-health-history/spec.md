# Feature Specification: Verified Longitudinal Health History

**Feature Branch**: `main`

**Created**: 2026-09-24

**Status**: Ready for planning

**Input**: User-supplied HealthLens AI MVP 1.0 functional requirements, sections 1–30.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Explore a verified health story (Priority: P1)

A fellowship reviewer selects an anonymous sample patient, sees available years, runs four
specialized agents, and explores a clear dashboard of measurements and supporting evidence.

**Why this priority**: This is the end-to-end demonstration of the product's core value.

**Independent Test**: Open the app, select PAT-001, analyze, select LDL, and inspect evidence.

**Acceptance Scenarios**:

1. **Given** the home screen, **When** Explore Sample Patient is selected, **Then** anonymous
   patient IDs and available years appear with a synthetic-data label.
2. **Given** PAT-001, **When** analysis starts, **Then** the history, trend, verification, and
   explanation agents report actual execution status and the completed dashboard opens.
3. **Given** the completed analysis, **When** LDL is selected, **Then** the chart and evidence
   show 105, 118, 132 mg/dL in 2024, 2025, 2026, +27 mg/dL and +25.7% overall change.
4. **Given** a finding, **When** evidence is opened, **Then** source record identifiers,
   original dates, values, units, and verified calculation details are visible.
5. **Given** an observation mismatch, **When** verification executes, **Then** that finding
   is excluded from verified explanations and the verification failure is reported.

### User Story 2 - Ask grounded follow-up questions (Priority: P2)

The reviewer asks what changed most, what increased consistently, what stayed stable, and why
a result was highlighted. Answers expose evidence and the agents used.

**Why this priority**: Questions make evidence and routing useful beyond static charts.

**Independent Test**: Ask “What changed the most?” then “Show me why you said that.”

**Acceptance Scenarios**:

1. **Given** a completed analysis, **When** a supported question is asked, **Then** the
   orchestrator retrieves the needed verified findings and returns an explanation and evidence.
2. **Given** a previous answer, **When** evidence is requested without naming a metric,
   **Then** the answer cites the same finding rather than an unrelated measurement.
3. **Given** a request to diagnose or prescribe, **When** submitted, **Then** the app declines
   that request and directs health concerns to a qualified professional.
4. **Given** unavailable runtime AI, **When** a question is asked, **Then** any deterministic
   explanation is explicitly labeled and no successful LLM call is claimed.

### User Story 3 - Analyze structured synthetic records (Priority: P3)

A reviewer uploads their own synthetic CSV or JSON records and uses the same analysis flow.

**Why this priority**: Demonstrates reusable analysis beyond the bundled example.

**Independent Test**: Download the example format, upload a valid file, analyze, inspect results.

**Acceptance Scenarios**:

1. **Given** valid records containing patient ID, date, measurement, numeric value and unit,
   **When** uploaded, **Then** the patient becomes selectable with source attribution.
2. **Given** invalid, empty, oversized, nonnumeric or conflicting records, **When** uploaded,
   **Then** a precise validation error appears and no partial patient is saved.
3. **Given** uploaded records, **When** the local data is reset, **Then** uploads and analyses
   are deleted while built-in demonstrations remain available.

### Edge Cases

- A single observation produces Insufficient Data; empty series produce no finding.
- Zero baseline makes percentage change unavailable; absolute change remains valid.
- Incompatible units are not merged; recognized conversions retain original values.
- Duplicates are rejected or deduplicated deterministically; conflicting same-date values fail.
- Missing years are disclosed; adjacent-observation changes are not called year-over-year
  unless the records are in consecutive years.
- Up/down reversals beyond tolerance are Fluctuating, even when endpoints are equal.
- Failed jobs display a failure message and permit retry; completion is never simulated.
- Unsupported questions state the available scope; uploaded text is data, never instructions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Provide home, sample selection, upload, processing and dashboard screens.
- **FR-002**: Include PAT-001 with 2024–2026 LDL values 105, 118, 132 and at least three
  anonymous synthetic patient profiles with source/provenance labels.
- **FR-003**: Normalize recognized aliases and compatible units, sort observations by date,
  retain original source evidence, and flag missing/incompatible data.
- **FR-004**: Calculate first/latest, absolute and percentage change, adjacent changes,
  direction and consistency. Classify Increasing, Decreasing, Stable, Fluctuating, or
  Insufficient Data and list largest increases/decreases and consistent/stable measurements.
- **FR-005**: Verify important conclusions against original records and recomputed arithmetic.
- **FR-006**: Generate the health story only after verification; show years, compared
  measurements, changes and verified finding counts derived from actual results.
- **FR-007**: Provide selectable line charts, trend cards and evidence drill-down for each metric.
- **FR-008**: Route follow-up questions through required agents; show evidence and activity.
- **FR-009**: Accept CSV and JSON with optional reference ranges; preserve supplied ranges
  as source information without adding clinical judgments.
- **FR-010**: Support ingestion of a suitable public synthetic Hugging Face dataset with
  explicit provenance and clearly distinguish it from the reproducible PAT-001 fixture.
- **FR-011**: Support an existing runtime LLM for language tasks after secure provider setup;
  deterministic math and verification remain authoritative. Disclose fallback use.
- **FR-012**: Display: “HealthLens AI is an informational prototype and does not provide medical
  diagnosis or treatment advice. Discuss health concerns with a qualified healthcare professional.”
- **FR-013**: Bound uploads to 2 MB and 10,000 observations, accept synthetic/de-identified
  demonstration records only, provide local reset, and keep records out of version control.
- **FR-014**: Present usable loading, empty, validation, failed-analysis and offline states;
  support keyboard interaction and layouts from 375px mobile to desktop.

### Key Entities *(include if feature involves data)*

- **Patient**: Anonymous identifier, source, available years and observation count.
- **Observation**: Patient, date, original/canonical measurement, value/unit, optional range,
  unique source locator and normalization provenance.
- **Analysis**: Patient, status, agent activity, trends, evidence, summary and derived counts.
- **Trend**: Ordered observations, calculations, direction, consistency and verification result.
- **Evidence**: Claim, original observations, calculation and verified or failed status.
- **Conversation**: Analysis-linked question, answer, referenced measurements and agents used.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The PAT-001 demonstration from selection to dashboard completes locally within
  10 seconds without live language generation, and within 60 seconds with configured AI.
- **SC-002**: Every displayed verified numerical claim links to original observations and
  passes deterministic recomputation; tampered evidence is not labeled verified.
- **SC-003**: The reviewer completes both prescribed questions and opens matching evidence
  without leaving the dashboard.
- **SC-004**: Valid example CSV and JSON files produce equivalent trends; invalid files
  produce clear feedback with no partial upload.
- **SC-005**: Primary actions, metric selection, evidence and chat work at desktop and mobile widths.

## Assumptions

- Local single-user fellowship prototype; public hosting and production clinical use are excluded.
- Stable means every adjacent change is within 1% of its nonzero prior value (absolute
  tolerance 0.01 at zero). Other reversals are Fluctuating; one direction plus stable periods
  is Increasing/Decreasing. This is descriptive math, not a clinical significance threshold.
- “Changed most” ranks absolute percentage change among verified comparable measurements
  with nonzero baselines, stating that ranking does not measure medical importance.
- The source years and counts are derived dynamically; PAT-001 is the fixed acceptance fixture.
- Structured uploads are local and explicitly user-resettable. Synthetic fixtures require no login.
- Runtime AI configuration is pending the user's provider/key choice; no secret is assumed.
