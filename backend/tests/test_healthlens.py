from datetime import datetime
import json

import pytest
from fastapi.testclient import TestClient

from backend.app.agents import history_agent, trend_agent, verification_agent, series_calculation, pending_analysis, normalize_observation
from backend.app.main import create_app
from backend.app.models import Observation
from backend.app.store import Store


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "test.sqlite3")


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "api.sqlite3")) as client:
        yield client


def observation(value, date, unit="mg/dL", measurement="LDL", **kwargs):
    return {"patient_id": "TEST", "date": date, "measurement": measurement,
            "value": value, "unit": unit, **kwargs}


def analyze(store, records):
    patient = store.ingest(records, "Synthetic test upload")[0]
    history = history_agent(store, patient["id"])
    trends, warnings = trend_agent(history["observations"])
    evidence = verification_agent(store, trends)
    return trends, evidence, warnings


def test_ldl_calculation_and_original_evidence(store):
    history = history_agent(store, "PAT-001")
    trends, warnings = trend_agent(history["observations"])
    evidence = verification_agent(store, trends)
    ldl = next(item for item in trends if item["measurement"] == "LDL")
    assert [o["value"] for o in ldl["observations"]] == [105, 118, 132]
    assert ldl["absolute_change"] == 27
    assert ldl["percentage_change"] == pytest.approx(25.71428571428571)
    assert ldl["direction"] == "Increasing"
    assert ldl["verified"] is True
    assert len(trends) == 18
    assert all(item["verified"] for item in evidence)
    assert not warnings


def test_zero_baseline_single_point_and_reversals(store):
    trends, _, _ = analyze(store, [
        observation(0, "2024-01-01"), observation(10, "2025-01-01"),
        observation(0, "2026-01-01"),
        observation(7, "2024-01-01", measurement="Only once"),
    ])
    ldl = next(t for t in trends if t["measurement"] == "LDL")
    assert ldl["percentage_change"] is None
    assert ldl["direction"] == "Fluctuating"
    assert next(t for t in trends if t["measurement"] == "Only once")["direction"] == "Insufficient Data"


def test_units_aliases_missing_years_and_originals(store):
    trends, evidence, warnings = analyze(store, [
        observation(100, "2024-01-01", measurement="LDL Cholesterol"),
        observation(3, "2026-01-01", unit="mmol/L"),
        observation(12, "2025-01-01", unit="bananas"),
    ])
    compatible = next(t for t in trends if t["unit"] == "mg/dL")
    assert compatible["latest_value"] == pytest.approx(116.01)
    assert compatible["changes"][0]["year_over_year"] is False
    assert any("Incompatible" in warning for warning in warnings)
    assert any("Missing" in warning for warning in warnings)
    original = next(e for e in evidence if e["id"] == compatible["evidence_id"])
    assert original["observations"][-1]["unit"] == "mmol/L"
    assert original["observations"][-1]["value"] == 3
    assert original["verified"]


def test_verifier_detects_changed_source_and_forged_calculation(store):
    history = history_agent(store, "PAT-001")
    trends, _ = trend_agent(history["observations"])
    ldl = next(t for t in trends if t["measurement"] == "LDL")
    ldl["absolute_change"] = 999
    evidence = verification_agent(store, [ldl])
    assert evidence[0]["verified"] is False
    assert ldl["verified"] is False
    trends, _ = trend_agent(history["observations"])
    ldl = next(t for t in trends if t["measurement"] == "LDL")
    with store.connection() as connection:
        row = connection.execute("SELECT raw_json FROM observations WHERE id=?", (ldl["observations"][0]["id"],)).fetchone()
        changed = json.loads(row[0])
        changed["value"] = 999
        connection.execute("UPDATE observations SET raw_json=? WHERE id=?", (json.dumps(changed), ldl["observations"][0]["id"]))
    assert verification_agent(store, [ldl])[0]["verified"] is False


def test_verifier_rejects_cherry_picked_observations(store):
    history = history_agent(store, "PAT-001")
    trends, _ = trend_agent(history["observations"])
    ldl = next(t for t in trends if t["measurement"] == "LDL")
    ldl["observations"] = [ldl["observations"][0], ldl["observations"][-1]]
    ldl.update(series_calculation(ldl["observations"]))
    result = verification_agent(store, [ldl])[0]
    assert result["verified"] is False
    assert any("omits" in note for note in result["verification_notes"])


def test_validation_is_atomic_and_duplicate_policy(store):
    before = len(store.patients())
    with pytest.raises(ValueError, match="conflict"):
        store.ingest([observation(1, "2024-01-01"), observation(2, "2024-01-01")], "Synthetic test")
    assert len(store.patients()) == before
    patients = store.ingest([observation(1, "2024-01-01"), observation(1, "2024-01-01")], "Synthetic test")
    assert patients[0]["observation_count"] == 1


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf"), True, "not numeric", 1e200])
def test_bad_numeric_values_rejected(bad):
    with pytest.raises(ValueError):
        Observation.model_validate(observation(bad, "2024-01-01", id="test", source="test"))


def test_invalid_calendar_date_and_numeric_patient_id(store):
    with pytest.raises(ValueError):
        store.ingest([observation(1, "2024-02-30")], "Synthetic test")
    records = [observation(1, "2024-01-01", patient_id=123)]
    assert store.ingest(records, "Synthetic test")[0]["observation_count"] == 1


def test_api_complete_flow_and_followup(client):
    assert client.get("/api/health").json()["explanation_mode"] == "deterministic"
    assert len(client.get("/api/patients").json()["patients"]) == 3
    analysis_id = client.post("/api/analyze/PAT-001").json()["analysis_id"]
    analysis = client.get(f"/api/analysis/{analysis_id}").json()
    assert analysis["status"] == "completed"
    assert analysis["stats"]["findings_verified"] == 18
    assert all(s["status"] == "completed" and s["started_at"] <= s["completed_at"] for s in analysis["stages"])
    response = client.post("/api/chat", json={"analysis_id": analysis_id, "question": "What changed the most?"}).json()
    assert response["measurements"]
    followup = client.post("/api/chat", json={"analysis_id": analysis_id, "question": "Show me why you said that", "previous_measurements": response["measurements"]}).json()
    assert followup["measurements"] == response["measurements"]
    assert followup["evidence"]
    assert followup["explanation_mode"] == "deterministic"
    refusal = client.post("/api/chat", json={"analysis_id": analysis_id, "question": "Do I have diabetes and what medicine should I take?"}).json()
    assert "cannot diagnose" in refusal["answer"]
    assert refusal["evidence"] == []
    unsupported = client.post("/api/chat", json={"analysis_id": analysis_id, "question": "Write Python code"}).json()
    assert "recorded measurements" in unsupported["answer"]


def test_upload_errors_limits_and_reset(client):
    invalid = client.post("/api/upload", files={"file": ("bad.csv", "patient_id,date,measurement,value,unit\nT,2024-01-01,LDL,NaN,mg/dL", "text/csv")})
    assert invalid.status_code == 422
    assert isinstance(invalid.json()["detail"], str)
    assert client.post("/api/upload", files={"file": ("huge.csv", b"x" * (2 * 1024 * 1024 + 1))}).status_code == 413
    assert client.post("/api/upload", files={"file": ("empty.json", b"[]", "application/json")}).status_code == 422
    sample = client.get("/api/sample.csv").text
    uploaded = client.post("/api/upload", files={"file": ("sample.csv", sample, "text/csv")})
    assert uploaded.status_code == 200
    patient_id = uploaded.json()["patients"][0]["id"]
    started = client.post(f"/api/analyze/{patient_id}")
    assert started.status_code == 200
    analysis = client.get(f"/api/analysis/{started.json()['analysis_id']}").json()
    assert analysis["status"] == "completed"
    assert [stage["name"] for stage in analysis["stages"]] == [
        "Patient History Agent", "Trend Analysis Agent", "Evidence Verification Agent", "Self-Explanation Agent",
    ]
    previous_completion = datetime.fromisoformat(analysis["created_at"])
    for stage in analysis["stages"]:
        assert stage["status"] == "completed"
        began = datetime.fromisoformat(stage["started_at"])
        ended = datetime.fromisoformat(stage["completed_at"])
        assert began.utcoffset() is not None and ended.utcoffset() is not None
        assert previous_completion <= began <= ended
        previous_completion = ended
    assert analysis["stats"] == {
        "years_analyzed": 3, "measurements_compared": 2, "changes_identified": 2, "findings_verified": 2,
    }
    ldl = next(trend for trend in analysis["trends"] if trend["measurement"] == "LDL")
    assert [record["value"] for record in ldl["observations"]] == [105, 118, 132]
    assert ldl["absolute_change"] == 27
    assert ldl["percentage_change"] == pytest.approx(25.71428571428571)
    assert all(trend["verified"] for trend in analysis["trends"])
    assert len(analysis["evidence"]) == 2
    assert all(evidence["verified"] for evidence in analysis["evidence"])
    assert all(record["source_patient_id"] == "DEMO-UPLOAD"
               for evidence in analysis["evidence"] for record in evidence["observations"])
    assert "LDL moved from 105 to 132 mg/dL" in analysis["summary"]
    assert analysis["explanation_mode"] == "deterministic"
    assert "no language model was called" in analysis["stages"][-1]["detail"]
    assert client.delete("/api/data").status_code == 200
    assert len(client.get("/api/patients").json()["patients"]) == 3
    assert client.get(f"/api/patients/{patient_id}/records").status_code == 404


def test_json_csv_equivalence_and_unknown_ids(client):
    records = [observation(100, "2024-01-01"), observation(110, "2025-01-01")]
    uploaded = client.post("/api/upload", files={"file": ("sample.json", json.dumps(records), "application/json")})
    patient_id = uploaded.json()["patients"][0]["id"]
    analysis_id = client.post(f"/api/analyze/{patient_id}").json()["analysis_id"]
    trend = client.get(f"/api/analysis/{analysis_id}/trends").json()["trends"][0]
    assert trend["percentage_change"] == 10
    assert client.get("/api/analysis/unknown").status_code == 404
    assert client.post("/api/analyze/unknown").status_code == 404
    assert client.post("/api/chat", json={"analysis_id": analysis_id, "question": " "}).status_code == 422
    csv = "patient_id,date,measurement,value,unit\nTEST,2024-01-01,LDL,100,mg/dL\nTEST,2025-01-01,LDL,110,mg/dL\n"
    csv_patient = client.post("/api/upload", files={"file": ("sample.csv", csv)}).json()["patients"][0]["id"]
    csv_analysis = client.post(f"/api/analyze/{csv_patient}").json()["analysis_id"]
    csv_trend = client.get(f"/api/analysis/{csv_analysis}/trends").json()["trends"][0]
    for key in ("first_value", "latest_value", "absolute_change", "percentage_change", "direction", "changes"):
        assert csv_trend[key] == trend[key]


def test_non_finite_json_never_escapes_and_row_cap(client):
    data = json.dumps([observation(1, "2024-01-01")] * 10001)
    response = client.post("/api/upload", files={"file": ("many.json", data, "application/json")})
    assert response.status_code == 422
    assert "10,000" in response.json()["detail"]


def test_finite_values_at_extreme_ratios_and_empty_history(store):
    trends, evidence, _ = analyze(store, [observation(1e-320, "2024-01-01"), observation(1e12, "2025-01-01")])
    assert trends[0]["percentage_change"] is None
    assert evidence[0]["verified"]
    json.dumps(trends, allow_nan=False)
    assert trend_agent([]) == ([], [])


def test_pending_chat_and_untrusted_origin_are_rejected(client):
    analysis = pending_analysis("PAT-001")
    client.app.state.store.save_analysis(analysis, create=True)
    assert client.post("/api/chat", json={"analysis_id": analysis["id"], "question": "What changed?"}).status_code == 409
    assert client.delete("/api/data", headers={"Origin": "https://untrusted.example"}).status_code == 403


def test_failed_verification_is_excluded_from_conversation(client):
    analysis_id = client.post("/api/analyze/PAT-001").json()["analysis_id"]
    store = client.app.state.store
    ldl = next(record for record in store.records("PAT-001") if record["measurement"] == "LDL")
    with store.connection() as db:
        changed = json.loads(db.execute("SELECT raw_json FROM observations WHERE id=?", (ldl["id"],)).fetchone()[0])
        changed["value"] = 999
        db.execute("UPDATE observations SET raw_json=? WHERE id=?", (json.dumps(changed), ldl["id"]))
    response = client.post("/api/chat", json={"analysis_id": analysis_id, "question": "Explain LDL"}).json()
    assert response["evidence"] == []
    assert response["measurements"] == []


def test_invalid_json_and_column_conflicts_are_atomic(client):
    for filename, content in [("bad.json", "[NaN]"), ("deep.json", "[" * 2000 + "0" + "]" * 2000),
                              ("bad.csv", "patient_id,date,measurement,value,unit,value\nT,2024-01-01,LDL,1,mg/dL,2")]:
        response = client.post("/api/upload", files={"file": (filename, content)})
        assert response.status_code == 422
        assert isinstance(response.json()["detail"], str)
    assert len(client.get("/api/patients").json()["patients"]) == 3


def test_required_summary_prompt_and_strict_every_year(client):
    analysis_id = client.post("/api/analyze/PAT-001").json()["analysis_id"]
    for question in ("Summarize my last three years", "Summarise my last three years"):
        response = client.post("/api/chat", json={"analysis_id": analysis_id, "question": question}).json()
        assert len(response["measurements"]) == 3
        assert response["measurements"] != ["AST"]
        assert response["evidence"]
    records = [observation(100, "2024-01-01", measurement="Annual"), observation(110, "2025-01-01", measurement="Annual"),
               observation(120, "2026-01-01", measurement="Annual"),
               observation(100, "2024-01-01", measurement="Stable interval"), observation(100.5, "2025-01-01", measurement="Stable interval"),
               observation(120, "2026-01-01", measurement="Stable interval"),
               observation(100, "2024-01-01", measurement="Gap"), observation(120, "2026-01-01", measurement="Gap")]
    patient_id = client.post("/api/upload", files={"file": ("annual.json", json.dumps(records))}).json()["patients"][0]["id"]
    analysis_id = client.post(f"/api/analyze/{patient_id}").json()["analysis_id"]
    response = client.post("/api/chat", json={"analysis_id": analysis_id, "question": "Which measurements increased every year?"}).json()
    assert response["measurements"] == ["Annual"]
    assert "stable intervals and gaps do not qualify" in response["answer"]


def test_verifier_rejects_forged_displayed_measurement(store):
    history = history_agent(store, "PAT-001")
    trends, _ = trend_agent(history["observations"])
    ldl = next(trend for trend in trends if trend["measurement"] == "LDL")
    ldl["measurement"] = "HDL"
    evidence = verification_agent(store, [ldl])[0]
    assert evidence["verified"] is False
    assert "HDL" not in evidence["claim"]
    assert any("Displayed measurement label" in note for note in evidence["verification_notes"])


@pytest.mark.parametrize("measurement,unit,canonical_unit,value", [
    ("Systolic Blood Pressure", "mm[Hg]", "mmHg", 10),
    ("Heart rate", "/min", "bpm", 10),
    ("Heart rate", "{beats}/min", "bpm", 10),
    ("Body weight", "[lb_av]", "kg", 4.5359237),
    ("BMI", "kg/m^2", "kg/m²", 10),
    ("Platelets", "10*9/L", "10³/µL", 10),
])
def test_common_ucum_units_are_compatible(measurement, unit, canonical_unit, value):
    normalized = normalize_observation(observation(10, "2024-01-01", unit=unit, measurement=measurement))
    assert normalized["unit"] == canonical_unit
    assert normalized["value"] == pytest.approx(value)
    assert normalized["original_unit"] == unit


def test_reset_between_patient_check_and_enqueue_cannot_create_orphan(client, monkeypatch):
    patient_id = client.post("/api/upload", files={"file": ("test.json", json.dumps([observation(1, "2024-01-01")]))}).json()["patients"][0]["id"]
    store = client.app.state.store
    original_patient = store.patient
    def interleaved_reset(identifier):
        patient = original_patient(identifier)
        store.reset()
        return patient
    monkeypatch.setattr(store, "patient", interleaved_reset)
    response = client.post(f"/api/analyze/{patient_id}")
    assert response.status_code == 404
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM analyses").fetchone()[0] == 0
