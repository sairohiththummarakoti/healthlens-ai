"""SQLite persistence with transaction-wide upload validation and independent raw evidence."""

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
from threading import RLock
from uuid import uuid4

from pydantic import ValidationError

from .models import Observation
from .seed import SOURCE, seed_records

MAX_RECORDS = 10_000


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS patients (
                    id TEXT PRIMARY KEY, source TEXT NOT NULL, source_url TEXT, builtin INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS observations (
                    id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                    record_json TEXT NOT NULL, raw_json TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS observations_patient ON observations(patient_id);
                CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
            """)
            for record in seed_records():
                db.execute("INSERT OR IGNORE INTO patients VALUES (?, ?, ?, 1)", (record["patient_id"], SOURCE, None))
                payload = json.dumps(record, allow_nan=False)
                db.execute("INSERT OR IGNORE INTO observations VALUES (?, ?, ?, ?)", (record["id"], record["patient_id"], payload, payload))

    @contextmanager
    def connection(self):
        with self.lock:
            db = sqlite3.connect(self.path, timeout=10)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()

    def patients(self):
        with self.connection() as db:
            patients = db.execute("SELECT * FROM patients ORDER BY builtin DESC,id").fetchall()
            output = []
            for patient in patients:
                records = [json.loads(row[0]) for row in db.execute("SELECT record_json FROM observations WHERE patient_id=?", (patient["id"],))]
                output.append({"id": patient["id"], "source": patient["source"], "source_url": patient["source_url"],
                               "years": sorted({int(record["date"][:4]) for record in records}), "observation_count": len(records)})
            return output

    def patient(self, patient_id):
        return next((p for p in self.patients() if p["id"] == patient_id), None)

    def records(self, patient_id):
        with self.connection() as db:
            records = [json.loads(row[0]) for row in db.execute("SELECT record_json FROM observations WHERE patient_id=?", (patient_id,))]
        return sorted(records, key=lambda item: (item["date"], item["measurement"], item["id"]))

    def raw_records(self, identifiers):
        # Do not use normalized/calculation objects as their own evidence.
        with self.connection() as db:
            return {identifier: json.loads(row[0]) for identifier in identifiers
                    if (row := db.execute("SELECT raw_json FROM observations WHERE id=?", (identifier,)).fetchone())}

    def raw_patient_records(self, patient_id):
        with self.connection() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT raw_json FROM observations WHERE patient_id=?", (patient_id,))]

    def ingest(self, records, source, source_url=None):
        from .agents import normalize_observation

        if not isinstance(records, list) or not records:
            raise ValueError("Upload must contain a non-empty array of observation records")
        if len(records) > MAX_RECORDS:
            raise ValueError("Upload exceeds the 10,000 observation limit")
        if not isinstance(source, str) or not source.strip() or len(source) > 250:
            raise ValueError("source must contain 1–250 characters")
        if source_url is not None and (not isinstance(source_url, str) or not source_url.startswith("https://") or len(source_url) > 1000):
            raise ValueError("source_url must be an HTTPS URL of at most 1,000 characters")
        validated = []
        keys = {}
        upload_id = uuid4().hex[:8]
        patient_ids = {}
        for index, item in enumerate(records, 1):
            if not isinstance(item, dict):
                raise ValueError(f"Record {index}: each observation must be an object")
            try:
                record_source = source
                if item.get("source"):
                    from .models import clean_text
                    record_source += " | " + clean_text(item["source"], "record source", 1000)
                record = Observation.model_validate({**item, "id": f"upload-{upload_id}-row-{index}", "source": record_source}).model_dump()
            except ValidationError as error:
                detail = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in error.errors())
                raise ValueError(f"Record {index}: {detail}") from None
            original_patient_id = record["patient_id"]
            # Keep uploads independent of both built-in patients and prior uploads.
            patient_ids.setdefault(original_patient_id, f"UP-{upload_id}-{len(patient_ids) + 1:03d}")
            record["patient_id"] = patient_ids[original_patient_id]
            normalized = normalize_observation(record)
            key = (original_patient_id, record["date"], normalized["measurement"])
            fingerprint = (normalized["value"], normalized["unit"], record["reference_range"])
            if key in keys:
                if keys[key] != fingerprint:
                    raise ValueError(f"Record {index}: conflicting values or units for the same patient/date/measurement")
                continue
            keys[key] = fingerprint
            record["source_patient_id"] = original_patient_id
            validated.append(record)
        with self.connection() as db:
            for patient_id in patient_ids.values():
                db.execute("INSERT INTO patients VALUES (?, ?, ?, 0)", (patient_id, source, source_url))
            for record in validated:
                payload = json.dumps(record, allow_nan=False)
                db.execute("INSERT INTO observations VALUES (?, ?, ?, ?)", (record["id"], record["patient_id"], payload, payload))
        return [patient for patient in self.patients() if patient["id"] in patient_ids.values()]

    def save_analysis(self, analysis, create=False):
        with self.connection() as db:
            payload = json.dumps(analysis, allow_nan=False)
            if create:
                # Hold the same lock/transaction as reset while validating the parent.
                # A reset between the HTTP precheck and enqueue must not resurrect work.
                if not db.execute("SELECT 1 FROM patients WHERE id=?", (analysis["patient_id"],)).fetchone():
                    return False
                db.execute("INSERT INTO analyses VALUES (?, ?)", (analysis["id"], payload))
                return True
            return db.execute("UPDATE analyses SET payload=? WHERE id=?", (payload, analysis["id"])).rowcount > 0

    def analysis(self, identifier):
        with self.connection() as db:
            row = db.execute("SELECT payload FROM analyses WHERE id=?", (identifier,)).fetchone()
            return json.loads(row[0]) if row else None

    def reset(self):
        with self.connection() as db:
            db.execute("DELETE FROM analyses")
            db.execute("DELETE FROM patients WHERE builtin=0")
