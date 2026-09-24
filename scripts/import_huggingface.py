"""Import a small, reproducible cohort of public synthetic Synthea observations.

The optional ``dataset`` extra is required only when reading Parquet. Nothing is
downloaded or sent to the application unless the corresponding CLI flag is set.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import tempfile
from typing import Callable, Iterable
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

DATASET = "george-essam-ai/synthea-healthcare-dataset"
REVISION = "a960cceb488b7a56a7ffabfd9d84f827bc684a5c"
FILENAME = "observations.parquet"
SHA256 = "591bad9843bcc314c860fffdfe5bdb83e8105ebd5985e0d1f4685cd95cd137b0"
SIZE_BYTES = 11_852_140
SOURCE_URL = f"https://huggingface.co/datasets/{DATASET}/resolve/{REVISION}/{FILENAME}"
SOURCE_LABEL = f"Synthetic Hugging Face observations (Synthea); revision {REVISION}"
COLUMNS = ["PATIENT", "DATE", "CODE", "DESCRIPTION", "VALUE", "UNITS", "TYPE"]

# These names are display aliases, not clinical interpretation. Values and units
# are retained unchanged. Unknown codes/units are excluded rather than guessed.
MEASUREMENTS = {
    "2089-1": ("LDL", {"mg/dL", "mmol/L"}),
    "2085-9": ("HDL", {"mg/dL", "mmol/L"}),
    "2093-3": ("Total Cholesterol", {"mg/dL", "mmol/L"}),
    "2571-8": ("Triglycerides", {"mg/dL", "mmol/L"}),
    "2345-7": ("Glucose", {"mg/dL", "mmol/L"}),
    "4548-4": ("HbA1c", {"%"}),
    "2160-0": ("Creatinine", {"mg/dL", "umol/L", "µmol/L"}),
    "3094-0": ("BUN", {"mg/dL"}),
    "718-7": ("Hemoglobin", {"g/dL", "g/L"}),
    "6690-2": ("WBC", {"10*3/uL", "10^3/uL", "10*9/L"}),
    "777-3": ("Platelets", {"10*3/uL", "10^3/uL", "10*9/L"}),
    "2951-2": ("Sodium", {"mmol/L", "mEq/L"}),
    "2823-3": ("Potassium", {"mmol/L", "mEq/L"}),
    "3016-3": ("TSH", {"mIU/L", "uIU/mL"}),
    "29463-7": ("Weight", {"kg", "lb", "[lb_av]"}),
    "39156-5": ("BMI", {"kg/m2", "kg/m^2", "kg/m²"}),
    "8480-6": ("Systolic Blood Pressure", {"mm[Hg]", "mmHg"}),
    "8462-4": ("Diastolic Blood Pressure", {"mm[Hg]", "mmHg"}),
    "8867-4": ("Heart Rate", {"/min", "{beats}/min", "bpm"}),
}


def check_digest(path: Path) -> None:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != SHA256:
        raise ValueError(f"SHA-256 mismatch for {path}; the pinned source was not verified.")


def download_source(cache_dir: Path) -> Path:
    """Download just the pinned observations table; cache only verified bytes."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    destination = cache_dir / FILENAME
    if destination.exists():
        check_digest(destination)
        return destination
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=cache_dir, suffix=".part", delete=False) as output:
            temporary = Path(output.name)
            total = 0
            request = Request(SOURCE_URL, headers={"User-Agent": "HealthLens-synthetic-importer/1.0"})
            with urlopen(request, timeout=60) as response:
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > SIZE_BYTES:
                        raise ValueError("Source exceeds the pinned download size.")
                    output.write(chunk)
        if total != SIZE_BYTES:
            raise ValueError("Incomplete source download; pinned byte count did not match.")
        check_digest(temporary)
        temporary.replace(destination)
        return destination
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def parquet_rows(path: Path) -> Iterable[tuple[int, dict]]:
    try:
        import pyarrow.parquet as pq
    except ImportError as error:
        raise RuntimeError("Install the optional reader with: uv sync --extra dataset --extra dev") from error
    parquet = pq.ParquetFile(path)
    missing = set(COLUMNS) - set(parquet.schema.names)
    if missing:
        raise ValueError(f"Missing source columns: {', '.join(sorted(missing))}")
    offset = 0
    for batch in parquet.iter_batches(batch_size=16_384, columns=COLUMNS):
        for row in batch.to_pylist():
            yield offset, row
            offset += 1


def normalized_row(index: int, row: dict) -> dict | None:
    code = str(row.get("CODE") or "")
    mapping = MEASUREMENTS.get(code)
    unit = str(row.get("UNITS") or "").strip()
    source_patient = str(row.get("PATIENT") or "").strip()
    if not mapping or unit not in mapping[1] or not source_patient:
        return None
    if str(row.get("TYPE") or "").lower() != "numeric":
        return None
    try:
        raw_date = str(row["DATE"])
        timestamp = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        value = float(row["VALUE"])
    except (KeyError, TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(value) or abs(value) > 1e12:
        return None
    return {"source_patient": source_patient, "date": timestamp.date().isoformat(),
            "year": timestamp.year, "measurement": mapping[0], "value": value,
            "unit": unit, "row_index": index, "raw_date": raw_date, "code": code,
            "description": str(row.get("DESCRIPTION") or "")}


def build_cohort(
    rows_factory: Callable[[], Iterable[tuple[int, dict]]],
    patient_count: int = 5,
    max_years: int = 5,
) -> dict:
    """Two bounded-memory passes; every exported number is an original value.

    Candidate qualification requires one same-measurement/same-unit series across
    three years. The first 10 * requested candidate IDs are checked for conflicting
    days; their sorted source IDs determine selection, not their health values.
    """
    if not 1 <= patient_count <= 5 or not 3 <= max_years <= 10:
        raise ValueError("Use 1–5 patients and 3–10 years.")
    series_years = defaultdict(set)
    scanned = accepted = 0
    for index, raw in rows_factory():
        scanned += 1
        row = normalized_row(index, raw)
        if row is None:
            continue
        accepted += 1
        key = (row["source_patient"], row["measurement"], row["unit"])
        series_years[key].add(row["year"])
    eligible = sorted({key[0] for key, years in series_years.items() if len(years) >= 3})
    if len(eligible) < patient_count:
        raise ValueError(f"Only {len(eligible)} eligible longitudinal patients; requested {patient_count}.")
    candidates = set(eligible[: patient_count * 10])
    latest_years = {}
    for patient in candidates:
        years = set().union(*(years for key, years in series_years.items() if key[0] == patient))
        latest_years[patient] = set(sorted(years)[-max_years:])
    del series_years

    by_day = {}
    conflicts = set()
    for index, raw in rows_factory():
        if str(raw.get("PATIENT") or "").strip() not in candidates:
            continue
        row = normalized_row(index, raw)
        if row is None or row["year"] not in latest_years[row["source_patient"]]:
            continue
        key = (row["source_patient"], row["date"], row["measurement"])
        previous = by_day.get(key)
        if previous and (previous["value"], previous["unit"]) != (row["value"], row["unit"]):
            conflicts.add(key)
        # Identical duplicates retain the first actual source locator.
        if previous is None:
            by_day[key] = row

    annual = {}
    for key, row in by_day.items():
        if key in conflicts:
            continue
        annual_key = (row["source_patient"], row["year"], row["measurement"], row["unit"])
        previous = annual.get(annual_key)
        if previous is None or (row["date"], -row["row_index"]) > (previous["date"], -previous["row_index"]):
            annual[annual_key] = row
    surviving_series = defaultdict(set)
    for row in annual.values():
        surviving_series[(row["source_patient"], row["measurement"], row["unit"])].add(row["year"])
    selected = sorted({key[0] for key, years in surviving_series.items() if len(years) >= 3})[:patient_count]
    if len(selected) != patient_count:
        raise ValueError("Not enough eligible patients remain after excluding conflicting days.")

    observations = []
    selected_rows = sorted((row for row in annual.values() if row["source_patient"] in selected),
                           key=lambda r: (r["source_patient"], r["date"], r["measurement"], r["unit"]))
    for row in selected_rows:
        anonymous_id = "HF-" + hashlib.sha256(row["source_patient"].encode()).hexdigest()[:12].upper()
        provenance = (f"HF {DATASET}@{REVISION}; {FILENAME}; row={row['row_index']}; "
                      f"code={row['code']}; DATE={row['raw_date']}; DESCRIPTION={row['description']}")
        observations.append({"patient_id": anonymous_id, "date": row["date"],
                             "measurement": row["measurement"], "value": row["value"],
                             "unit": row["unit"], "source": provenance,
                             "source_record_id": f"{FILENAME}:row:{row['row_index']}"})
    patient_summaries = []
    for patient_id in sorted({record["patient_id"] for record in observations}):
        records = [record for record in observations if record["patient_id"] == patient_id]
        patient_summaries.append({"id": patient_id, "observations": len(records),
                                  "years": sorted({int(r["date"][:4]) for r in records}),
                                  "date_from": min(r["date"] for r in records),
                                  "date_to": max(r["date"] for r in records),
                                  "measurements": len({r["measurement"] for r in records})})
    manifest = {
        "importer_version": 1, "dataset": DATASET, "revision": REVISION,
        "file": FILENAME, "url": SOURCE_URL, "sha256": SHA256, "license": "Apache-2.0",
        "source_row_indexing": "Zero-based physical Parquet row order across row groups.",
        "rows_scanned": scanned, "recognized_numeric_rows": accepted,
        "eligible_patients_before_conflict_filter": len(eligible),
        "excluded_conflicting_days": sum(key[0] in selected for key in conflicts),
        "selection": f"First {patient_count} eligible source IDs; latest {max_years} observed years; "
                     "last nonconflicting annual observation per recognized measurement/unit; "
                     "at least one series spans three years; no interpolation or changed values.",
        "patients": patient_summaries,
    }
    return {"observations": observations, "manifest": manifest}


def local_upload_url(base_url: str) -> str:
    parsed = urlsplit(base_url)
    if (parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"}):
        raise ValueError("Import URL must be an HTTP loopback origin, e.g. http://127.0.0.1:8000.")
    return base_url.rstrip("/") + "/api/upload"


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("The local upload endpoint must not redirect.")


def upload_to_app(base_url: str, payload: bytes) -> dict:
    url = local_upload_url(base_url)
    if len(payload) > 2 * 1024 * 1024:
        raise ValueError("Generated cohort exceeds the application's 2 MB upload cap.")
    boundary = "HealthLensSyntheticDatasetImport"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            "filename=\"huggingface-synthetic.json\"\r\nContent-Type: application/json\r\n\r\n").encode()
    body += payload + f"\r\n--{boundary}--\r\n".encode()
    request = Request(url, data=body, method="POST",
                      headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with build_opener(NoRedirects()).open(request, timeout=60) as response:
        return json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Download the pinned 12 MB observation file.")
    parser.add_argument("--cache-dir", type=Path, default=Path("data/huggingface"))
    parser.add_argument("--output", type=Path, default=Path("data/huggingface/cohort.json"))
    parser.add_argument("--patients", type=int, choices=range(3, 6), default=5)
    parser.add_argument("--years", type=int, choices=range(3, 11), default=5)
    parser.add_argument("--import-url", help="Also upload to a running local API, e.g. http://127.0.0.1:8000.")
    args = parser.parse_args()
    if args.import_url:
        local_upload_url(args.import_url)
    source = args.cache_dir / FILENAME
    if args.download:
        source = download_source(args.cache_dir)
    if not source.exists():
        parser.error("Cached source not found. Add --download to fetch the pinned synthetic source.")
    check_digest(source)
    result = build_cohort(lambda: parquet_rows(source), args.patients, args.years)
    envelope = {"source": SOURCE_LABEL, "source_url": SOURCE_URL, "records": result["observations"]}
    payload = json.dumps(envelope, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
    if len(payload) > 2 * 1024 * 1024 or len(envelope["records"]) > 10_000:
        raise ValueError("Cohort exceeds app limits; reduce --patients or --years.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    manifest_path = args.output.with_suffix(".provenance.json")
    manifest_path.write_text(json.dumps(result["manifest"], indent=2), encoding="utf-8")
    report = {"verified_sha256": SHA256, "observations": len(envelope["records"]),
              "output": str(args.output), "provenance": str(manifest_path),
              "patients": result["manifest"]["patients"]}
    if args.import_url:
        response = upload_to_app(args.import_url, payload)
        report["imported_patient_ids"] = [p["id"] for p in response["patients"]]
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
