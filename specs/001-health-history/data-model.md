# Data Model

Patient: id (1–80 safe characters), source, source_url (optional), years[], observation_count.
Observation: id, patient_id, date (ISO calendar date), measurement (1–100 characters), value
(finite number bounded to ±1e12), unit (1–40 characters), reference_range (optional <=100 characters), source.
NormalizedObservation adds canonical measurement/value/unit, while retaining the original record.
Trend: measurement, unit, observations[], first_value, latest_value, absolute_change,
percentage_change (null if zero baseline), direction, consistency, changes[], verified, evidence_id.
Evidence: id, measurement, claim, verified, observations[], calculation, verification_notes[].
Analysis: id, patient_id, status (pending/running/completed/failed), created_at, stages[],
summary, explanation_mode, years[], stats, trends[], evidence[], warnings[].
AgentStage: name, status (pending/running/completed/failed), started_at, completed_at, detail.
Chat: question (1–2000 characters), analysis_id, optional previous_measurements[], answer,
evidence[], agents_used[], explanation_mode. Prior references are scoped to the current analysis.

Persistence: SQLite stores source patients/records and analysis JSON; local reset removes uploads
and analyses and retains synthetic seed patients. Upload validates whole file before transaction.
Date and unit validation precede analysis; duplicate exact records are deduplicated, conflicting
same-patient/date/measurement records are rejected. Server generates identifiers for uploads.
