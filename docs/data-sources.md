# Synthetic data sources

HealthLens distinguishes its bundled `PAT-*` acceptance examples from downloaded
Hugging Face observations. Both are synthetic; neither represents real people.

## Bundled acceptance examples

`backend/app/seed.py` defines reproducible application fixtures. In particular,
PAT-001's LDL values are 105, 118 and 132 mg/dL in 2024–2026. These deliberately
authored examples are **not records downloaded from Hugging Face**.

## Optional Hugging Face import

Dataset: [george-essam-ai/synthea-healthcare-dataset](https://huggingface.co/datasets/george-essam-ai/synthea-healthcare-dataset).
Pinned revision: `a960cceb488b7a56a7ffabfd9d84f827bc684a5c`.
License: Apache-2.0, as declared in the
[pinned dataset card](https://huggingface.co/datasets/george-essam-ai/synthea-healthcare-dataset/raw/a960cceb488b7a56a7ffabfd9d84f827bc684a5c/README.md).
Original generator: [Synthea by The MITRE Corporation](https://github.com/synthetichealth/synthea),
also Apache-2.0. Attribute both Synthea and the Hugging Face dataset publisher when
redistributing derived cohorts, and retain their applicable license notices.

The importer fetches only
[observations.parquet](https://huggingface.co/datasets/george-essam-ai/synthea-healthcare-dataset/resolve/a960cceb488b7a56a7ffabfd9d84f827bc684a5c/observations.parquet):
11,852,140 bytes compressed, 2,490,591 rows. It does not fetch patient demographics,
names, addresses, or the much larger collection of related tables.

Expected SHA-256:

```text
591bad9843bcc314c860fffdfe5bdb83e8105ebd5985e0d1f4685cd95cd137b0
```

Verified source schema: nullable UTF-8 columns `DATE`, `PATIENT`, `ENCOUNTER`,
`CODE`, `DESCRIPTION`, `VALUE`, `UNITS`, `TYPE`, `CATEGORY`. The importer reads
only the seven columns it requires. Numeric values must parse to finite numbers;
dates and code-specific units must be recognized. It uses actual source rows,
not generated substitutes.

### Reproduce and upload

From the repository root:

```powershell
uv sync --extra dev --extra dataset
uv run python scripts/import_huggingface.py --download
```

This writes `data/huggingface/cohort.json` and
`data/huggingface/cohort.provenance.json`. The source cache and generated cohorts
are ignored by Git. Upload `cohort.json` through the application's upload dialog,
or, with the API running locally:

```powershell
uv run python scripts/import_huggingface.py --import-url http://127.0.0.1:8000
```

The explicit `--download` flag enables network retrieval. Without it, an existing
verified cache is required. `--import-url` uploads only to an HTTP loopback origin
and refuses redirects. No access token is required. The app assigns its own local
upload identifiers while retaining the source anonymous identifier and provenance.
Resetting local data removes the imported patients; it does not delete the cache.

### Selection and evidence

The default export contains five anonymous `HF-*` source patients. `--patients 3`
or `--patients 4` selects smaller cohorts. Every qualifying patient has at least
one recognized measurement/unit series across three distinct source years.

Selection follows sorted original source IDs, independent of measurement values.
The importer considers the first ten times the requested candidate count, excludes
conflicting same-day measurement values/units, then selects the first qualifying
patients. Exact duplicate observations retain their first source row locator.
Each patient's latest five observed years are retained (configurable with
`--years 3` through `--years 10`). Within each measurement/unit and year, the last
nonconflicting observation is selected. Missing years are not filled, values are
not averaged or changed, and original units are retained.

This annual sampling makes the imported cohort small enough for the application's
2 MB / 10,000-observation limit. It is not the patient's complete record and may
omit intervening changes. The importer supports a documented allowlist of common
LOINC measurement codes in `MEASUREMENTS`; unrecognized codes and units are skipped.
Code-to-name aliases make chart labels readable. Original descriptions, codes,
timestamps, source revision, and zero-based Parquet row indexes remain in every
record's `source`, with a separate `source_record_id` locator. The provenance
sidecar records the pinned URL, full SHA-256, selection rules, and counts.

### Verified import result

The default importer was exercised against the pinned source on September 24,
2026. The download's SHA-256 matched. It exported 172 observations for five
anonymous source patients, with five observed years per patient and 8–12 distinct
measurement labels. Source date spans were 2015–2019, 2016–2020, or 2017–2021.
The JSON upload was 75,585 bytes. Uploading the actual cohort to an isolated local
API database and analyzing all five patients completed successfully; all 50
produced evidence findings passed source verification and retained row locators.

The isolated importer tests cover reproducibility, original-value provenance,
annual selection, missing years, invalid data, conflicts, checksum rejection,
loopback upload restrictions, and provenance through the API analysis flow:

```powershell
uv run pytest backend/tests/test_hf_import.py -q
```

### Limitations

- The publisher aggregates several Synthea releases and does not enumerate every
  original generator version or random seed. Provenance to the pinned HF artifact
  is exact; the earlier generation history is limited by the publisher's record.
- The dataset card mentions a `parquet_data/` directory, but the verified files
  are at the repository root. Use the pinned URLs above.
- The default Hugging Face dataset configuration combines unrelated table schemas;
  the importer deliberately reads the explicit observation file.
- Reference ranges are not supplied in this table. The importer does not invent
  ranges, clinical severity, diagnoses, or treatment recommendations.
- Synthetic records are for software demonstration and education. They do not
  demonstrate clinical effectiveness or real-world population statistics.
