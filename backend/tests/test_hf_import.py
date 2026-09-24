"""Trust boundaries for the optional, deterministic synthetic-data importer."""

import json

import pytest

from scripts.import_huggingface import (
    REVISION,
    SOURCE_LABEL,
    SOURCE_URL,
    build_cohort,
    check_digest,
    local_upload_url,
)


def source_row(patient, year, value, code="2089-1", **changes):
    row = {"PATIENT": patient, "DATE": f"{year}-06-01T12:00:00Z", "CODE": code,
           "DESCRIPTION": "Low Density Lipoprotein Cholesterol", "VALUE": str(value),
           "UNITS": "mg/dL", "TYPE": "numeric", "ENCOUNTER": "example"}
    row.update(changes)
    return row


def build(rows, **kwargs):
    return build_cohort(lambda: iter(enumerate(rows)), **kwargs)


def test_cohort_uses_actual_source_values_and_full_provenance():
    rows = [source_row(patient, year, year - 1900)
            for patient in ["p-b", "p-a", "p-c"] for year in [2018, 2020, 2023]]
    result = build(rows, patient_count=3)
    assert len(result["manifest"]["patients"]) == 3
    assert len(result["observations"]) == 9
    assert {r["value"] for r in result["observations"]} == {118.0, 120.0, 123.0}
    assert all(r["patient_id"].startswith("HF-") for r in result["observations"])
    assert all(REVISION in r["source"] for r in result["observations"])
    assert all("row=" in r["source"] for r in result["observations"])
    assert all(r["measurement"] == "LDL" for r in result["observations"])
    assert "p-a" not in json.dumps(result)
    assert build(rows, patient_count=3) == result


def test_latest_annual_record_is_preserved_and_missing_years_not_filled():
    rows = [source_row("p", year, 100 + year % 10) for year in [2001, 2003, 2005, 2007]]
    rows.append(source_row("p", 2007, 140, DATE="2007-11-20T09:00:00Z"))
    result = build(rows, patient_count=1, max_years=3)
    assert [r["date"] for r in result["observations"]] == ["2003-06-01", "2005-06-01", "2007-11-20"]
    assert result["observations"][-1]["value"] == 140
    assert "2007-11-20T09:00:00Z" in result["observations"][-1]["source"]
    assert "row=4" in result["observations"][-1]["source"]


def test_invalid_values_and_units_do_not_qualify_patient():
    rows = [source_row("p", 2020, 100), source_row("p", 2021, "nan"),
            source_row("p", 2022, "inf"), source_row("p", 2023, 100, UNITS="bananas"),
            source_row("p", 2024, 100, DATE="2024-02-30")]
    with pytest.raises(ValueError, match="eligible"):
        build(rows, patient_count=1)


def test_does_not_count_different_metrics_as_longitudinal_series():
    rows = [source_row("p", 2020, 100), source_row("p", 2021, 50, code="2085-9"),
            source_row("p", 2022, 90, code="2345-7")]
    with pytest.raises(ValueError, match="eligible"):
        build(rows, patient_count=1)


def test_conflicting_same_day_measurement_is_skipped_not_silently_chosen():
    rows = [source_row("p", year, 100) for year in [2020, 2021, 2022, 2023]]
    rows.append(source_row("p", 2023, 140))
    result = build(rows, patient_count=1)
    assert len(result["observations"]) == 3
    assert result["manifest"]["excluded_conflicting_days"] == 1


def test_hash_and_loopback_upload_guards(tmp_path):
    path = tmp_path / "observations.parquet"
    path.write_bytes(b"changed content")
    with pytest.raises(ValueError, match="SHA-256"):
        check_digest(path)
    assert local_upload_url("http://127.0.0.1:8000") == "http://127.0.0.1:8000/api/upload"
    for url in ["https://example.com", "http://user:pass@127.0.0.1", "http://127.0.0.1/other"]:
        with pytest.raises(ValueError, match="loopback"):
            local_upload_url(url)


def test_import_envelope_retains_provenance_through_analysis(tmp_path):
    from fastapi.testclient import TestClient

    from backend.app.main import create_app

    cohort = build([source_row("anonymous-source", year, 100 + (year - 2020) * 10)
                    for year in [2020, 2021, 2022]], patient_count=1)
    payload = {"source": SOURCE_LABEL, "source_url": SOURCE_URL, "records": cohort["observations"]}
    with TestClient(create_app(tmp_path / "hf-test.sqlite3")) as client:
        uploaded = client.post("/api/upload", files={"file": ("hf.json", json.dumps(payload), "application/json")})
        assert uploaded.status_code == 200, uploaded.text
        patient = uploaded.json()["patients"][0]
        assert patient["source_url"] == SOURCE_URL
        analysis_id = client.post(f"/api/analyze/{patient['id']}").json()["analysis_id"]
        analysis = client.get(f"/api/analysis/{analysis_id}").json()
        assert analysis["status"] == "completed"
        evidence = analysis["evidence"][0]
        assert evidence["verified"]
        assert evidence["observations"][0]["source_record_id"] == "observations.parquet:row:0"
        assert REVISION in evidence["observations"][0]["source"]
        assert analysis["trends"][0]["percentage_change"] == 20
