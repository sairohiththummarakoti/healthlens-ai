"""Four executable agents: retrieval, arithmetic, independent verification, and explanation.

The explanation agent is deliberately deterministic until a provider is explicitly configured.
"""

from datetime import datetime, timezone
import math
import re
from uuid import uuid4

from .seed import METRICS

DISCLAIMER = "HealthLens AI is an informational prototype and does not provide medical diagnosis or treatment advice. Discuss health concerns with a qualified healthcare professional."
AGENT_NAMES = ["Patient History Agent", "Trend Analysis Agent", "Evidence Verification Agent", "Self-Explanation Agent"]
ALIASES = {
    "ldl cholesterol": "LDL", "ldl c": "LDL", "low density lipoprotein": "LDL",
    "hdl cholesterol": "HDL", "hdl c": "HDL", "high density lipoprotein": "HDL",
    "cholesterol": "Total Cholesterol", "total serum cholesterol": "Total Cholesterol",
    "fasting glucose": "Glucose", "blood glucose": "Glucose", "glucose fasting": "Glucose",
    "a1c": "HbA1c", "hemoglobin a1c": "HbA1c", "hba1c": "HbA1c",
    "systolic": "Systolic Blood Pressure", "systolic bp": "Systolic Blood Pressure",
    "diastolic": "Diastolic Blood Pressure", "diastolic bp": "Diastolic Blood Pressure",
    "body mass index": "BMI", "body weight": "Weight", "heart rate": "Resting Heart Rate",
    "pulse": "Resting Heart Rate", "platelet count": "Platelets", "vitamin d 25 oh": "Vitamin D",
}


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def text_key(value):
    return re.sub(r"[\s_-]+", " ", value.lower()).strip()


def mentions(question, phrase):
    """Whole-name matching keeps short measurements (AST, ALT) out of words like 'last'."""
    return re.search(r"(?<!\w)" + re.escape(phrase.lower()) + r"(?!\w)", question) is not None


def normalize_observation(record):
    normalized = dict(record)
    key = text_key(record["measurement"])
    canonical = {text_key(metric): metric for metric in METRICS}
    metric = ALIASES.get(key, canonical.get(key, record["measurement"].strip()))
    unit_key = record["unit"].replace(" ", "").lower().replace("μ", "µ")
    units = {"mg/dl": "mg/dL", "mmol/l": "mmol/L", "kg": "kg", "mmhg": "mmHg", "mm[hg]": "mmHg",
             "g/dl": "g/dL", "g/l": "g/L", "bpm": "bpm", "beats/min": "bpm", "{beats}/min": "bpm", "%": "%",
             "kg/m2": "kg/m²", "kg/m²": "kg/m²", "kg/m^2": "kg/m²", "ng/ml": "ng/mL", "u/l": "U/L",
             "miu/l": "mIU/L", "uiu/ml": "mIU/L", "10^3/ul": "10³/µL", "10³/µl": "10³/µL",
             "10*3/ul": "10³/µL", "10^9/l": "10³/µL", "10*9/l": "10³/µL", "lbs": "lb", "lb": "lb", "[lb_av]": "lb"}
    unit = units.get(unit_key, record["unit"].strip())
    if metric == "Resting Heart Rate" and unit_key in ("/min", "1/min"):
        unit = "bpm"
    value = float(record["value"])
    if metric in ("LDL", "HDL", "Total Cholesterol") and unit == "mmol/L":
        value, unit = value * 38.67, "mg/dL"
    elif metric == "Triglycerides" and unit == "mmol/L":
        value, unit = value * 88.57, "mg/dL"
    elif metric == "Glucose" and unit == "mmol/L":
        value, unit = value * 18.0182, "mg/dL"
    elif metric == "Weight" and unit == "lb":
        value, unit = value * 0.45359237, "kg"
    elif metric == "Hemoglobin" and unit == "g/L":
        value, unit = value / 10, "g/dL"
    normalized.update(measurement=metric, value=value, unit=unit,
                      original_measurement=record["measurement"], original_value=record["value"], original_unit=record["unit"])
    return normalized


def percentage(delta, baseline):
    if baseline == 0:
        return None
    result = delta / abs(baseline) * 100
    return result if math.isfinite(result) else None


def series_calculation(observations):
    first, latest = observations[0]["value"], observations[-1]["value"]
    changes = []
    signs = set()
    for previous, current in zip(observations, observations[1:]):
        delta = current["value"] - previous["value"]
        tolerance = abs(previous["value"]) * 0.01 if previous["value"] else 0.01
        signs.add(0 if abs(delta) <= tolerance + 1e-12 else (1 if delta > 0 else -1))
        changes.append({"from_date": previous["date"], "to_date": current["date"], "absolute_change": delta,
                        "percentage_change": percentage(delta, previous["value"]),
                        "year_over_year": int(current["date"][:4]) - int(previous["date"][:4]) == 1})
    if len(observations) < 2:
        direction, consistency = "Insufficient Data", "A second observation is needed"
    elif 1 in signs and -1 in signs:
        direction, consistency = "Fluctuating", "Direction reverses between observations"
    elif signs == {0}:
        direction, consistency = "Stable", "All adjacent changes are within the descriptive tolerance"
    elif 1 in signs:
        direction, consistency = "Increasing", "Consistent increase, allowing stable intervals"
    else:
        direction, consistency = "Decreasing", "Consistent decrease, allowing stable intervals"
    return {"first_value": first, "latest_value": latest, "absolute_change": latest - first,
            "percentage_change": percentage(latest - first, first), "direction": direction,
            "consistency": consistency, "changes": changes}


def history_agent(store, patient_id):
    patient = store.patient(patient_id)
    if patient is None:
        raise ValueError("The selected patient is no longer available")
    records = store.records(patient_id)
    if not records:
        raise ValueError("No observations are available for this patient")
    return {"patient": patient, "observations": [normalize_observation(record) for record in records]}


def trend_agent(observations):
    groups, metric_units, warnings = {}, {}, []
    for record in observations:
        key = (record["measurement"], record["unit"])
        groups.setdefault(key, []).append(record)
        metric_units.setdefault(key[0], set()).add(key[1])
    for metric, units in metric_units.items():
        if len(units) > 1:
            warnings.append(f"Incompatible units for {metric}: {', '.join(sorted(units))}. These series are kept separate.")
    trends = []
    for (metric, unit), records in sorted(groups.items()):
        records = sorted(records, key=lambda item: (item["date"], item["id"]))
        years = {int(record["date"][:4]) for record in records}
        missing = sorted(set(range(min(years), max(years) + 1)) - years)
        name = f"{metric} · {unit}" if len(metric_units[metric]) > 1 else metric
        if missing:
            warnings.append(f"Missing years for {name}: {', '.join(map(str, missing))}; comparisons use available observations.")
        calculation = series_calculation(records)
        if calculation["percentage_change"] is None:
            warnings.append(f"Percentage change for {name} is unavailable because its baseline is zero or the ratio is outside numeric bounds.")
        trends.append({"measurement": name, "base_measurement": metric, "unit": unit, "observations": records,
                       **calculation, "verified": False, "evidence_id": f"evidence-{uuid4().hex}"})
    return trends, warnings


def equal_numbers(a, b):
    if a is None or b is None:
        return a is b
    return math.isclose(a, b, rel_tol=1e-10, abs_tol=1e-10)


def format_number(value):
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def claim_for(trend):
    if len(trend["observations"]) < 2:
        return f"{trend['measurement']} has one observation; there is insufficient data to describe a trend."
    pct = trend["percentage_change"]
    percent_text = "percentage unavailable" if pct is None else f"{pct:+.1f}%"
    return (f"{trend['measurement']} moved from {format_number(trend['first_value'])} to "
            f"{format_number(trend['latest_value'])} {trend['unit']} ({trend['absolute_change']:+.2f} {trend['unit']}, "
            f"{percent_text}); its recorded pattern is {trend['direction'].lower()}.")


def verification_agent(store, trends):
    evidence = []
    raw = store.raw_records([record["id"] for trend in trends for record in trend["observations"]])
    patient_sources = {}
    for trend in trends:
        notes, originals = [], []
        for observation in trend["observations"]:
            original = raw.get(observation["id"])
            if original is None:
                notes.append(f"Original source record {observation['id']} is missing")
                continue
            originals.append(original)
            normalized = normalize_observation(original)
            for key in ("patient_id", "date", "measurement", "unit", "source", "reference_range", "source_record_id"):
                if normalized.get(key) != observation.get(key):
                    notes.append(f"Source mismatch for {observation['id']}: {key}")
            if not equal_numbers(normalized["value"], observation["value"]):
                notes.append(f"Source value mismatch for {observation['id']}")
        if originals:
            normalized = sorted([normalize_observation(record) for record in originals], key=lambda item: (item["date"], item["id"]))
            patient_id = originals[0]["patient_id"]
            if patient_id not in patient_sources:
                patient_sources[patient_id] = [normalize_observation(record) for record in store.raw_patient_records(patient_id)]
            source_metric = normalized[0]["measurement"]
            source_unit = normalized[0]["unit"]
            source_units = {record["unit"] for record in patient_sources[patient_id] if record["measurement"] == source_metric}
            expected_label = f"{source_metric} · {source_unit}" if len(source_units) > 1 else source_metric
            if trend["measurement"] != expected_label:
                notes.append("Displayed measurement label does not match the original source series")
            source_ids = sorted(record["id"] for record in patient_sources[patient_id]
                                if record["measurement"] == normalized[0]["measurement"] and record["unit"] == normalized[0]["unit"])
            if source_ids != sorted(record["id"] for record in originals):
                notes.append("The proposed series omits or duplicates original source observations")
            if [record["id"] for record in normalized] != [record["id"] for record in trend["observations"]]:
                notes.append("Observation order does not match chronological source order")
            recomputed = series_calculation(normalized)
            for key in ("first_value", "latest_value", "absolute_change", "percentage_change"):
                if not equal_numbers(trend[key], recomputed[key]):
                    notes.append(f"Recomputed {key} does not match")
            if trend["direction"] != recomputed["direction"] or trend["changes"] != recomputed["changes"] or trend["consistency"] != recomputed["consistency"]:
                notes.append("Recomputed direction or adjacent changes do not match")
            if trend["unit"] != normalized[0]["unit"] or trend.get("base_measurement", trend["measurement"]) != normalized[0]["measurement"]:
                notes.append("Series label does not match source measurements")
        if not originals or len(originals) != len(trend["observations"]):
            notes.append("Not all observations were recoverable from source storage")
        verified = not notes
        trend["verified"] = verified
        pct = trend["percentage_change"]
        calculation = (f"Absolute change = {format_number(trend['latest_value'])} − {format_number(trend['first_value'])} "
                       f"= {format_number(trend['absolute_change'])} {trend['unit']}. "
                       + (f"Percentage = absolute change ÷ |first value| × 100 = {pct:.1f}%." if pct is not None else "Percentage unavailable at a zero baseline or outside numeric bounds."))
        evidence.append({"id": trend["evidence_id"], "measurement": trend["measurement"], "verified": verified,
                         "claim": claim_for(trend) if verified else "This finding could not be verified against its original records.",
                         "observations": originals, "calculation": calculation,
                         "verification_notes": notes or ["Original record identifiers, dates, values, units and source matched.",
                                                          "Arithmetic and direction independently recomputed from raw source records."]})
    return evidence


def explanation_agent(trends, years, summary=True):
    verified = [trend for trend in trends if trend["verified"]]
    if not summary:
        return " ".join(claim_for(trend) for trend in verified) if verified else "No verified measurements match that question in the available records."
    comparable = [trend for trend in verified if len(trend["observations"]) >= 2]
    ranked = sorted([trend for trend in comparable if trend["percentage_change"] is not None], key=lambda trend: abs(trend["percentage_change"]), reverse=True)
    increasing = sum(trend["direction"] == "Increasing" for trend in comparable)
    decreasing = sum(trend["direction"] == "Decreasing" for trend in comparable)
    stable = sum(trend["direction"] == "Stable" for trend in comparable)
    introduction = (f"Your available records span {min(years)}–{max(years)} across {len(years)} recorded years. "
                    f"We compared {len(comparable)} measurements: {increasing} increasing, {decreasing} decreasing, and {stable} stable. ")
    detail = ("The largest relative change was " + claim_for(ranked[0])) if ranked else "There is not enough comparable data to rank relative changes."
    return introduction + detail + " Direction describes the records, not medical improvement or decline."


def pending_analysis(patient_id):
    return {"id": uuid4().hex, "patient_id": patient_id, "status": "pending", "created_at": timestamp(),
            "stages": [{"name": name, "status": "pending", "detail": "Waiting to execute"} for name in AGENT_NAMES],
            "summary": "", "explanation_mode": "deterministic", "years": [],
            "stats": {"years_analyzed": 0, "measurements_compared": 0, "changes_identified": 0, "findings_verified": 0},
            "trends": [], "evidence": [], "warnings": []}


def run_analysis(store, analysis):
    active = None
    try:
        analysis["status"] = "running"
        history = None
        for index, active in enumerate(analysis["stages"]):
            active.update(status="running", started_at=timestamp(), detail="Executing")
            if not store.save_analysis(analysis):
                return  # A local reset canceled this job.
            if index == 0:
                history = history_agent(store, analysis["patient_id"])
                analysis["years"] = history["patient"]["years"]
                detail = f"Retrieved {len(history['observations'])} source observations"
            elif index == 1:
                analysis["trends"], analysis["warnings"] = trend_agent(history["observations"])
                detail = f"Calculated {len(analysis['trends'])} measurement histories"
            elif index == 2:
                analysis["evidence"] = verification_agent(store, analysis["trends"])
                verified_count = sum(e["verified"] for e in analysis["evidence"])
                detail = f"Verified {verified_count} of {len(analysis['evidence'])} findings against raw sources"
                if verified_count < len(analysis["evidence"]):
                    analysis["warnings"].append("Some findings failed source verification and are excluded from explanations.")
            else:
                analysis["summary"] = explanation_agent(analysis["trends"], analysis["years"])
                detail = "Created a deterministic explanation from verified findings; no language model was called"
            active.update(status="completed", completed_at=timestamp(), detail=detail)
            if not store.save_analysis(analysis):
                return
        trends = analysis["trends"]
        analysis["stats"] = {"years_analyzed": len(analysis["years"]),
                             "measurements_compared": sum(len(t["observations"]) >= 2 for t in trends),
                             "changes_identified": sum(t["verified"] and t["direction"] not in ("Stable", "Insufficient Data") for t in trends),
                             "findings_verified": sum(t["verified"] for t in trends)}
        analysis["status"] = "completed"
        store.save_analysis(analysis)
    except Exception:
        # Keep internal exception data out of the API; stage and retry information stay available.
        analysis.update(status="failed", error="Analysis could not finish. The records may have been reset; select a patient and try again.")
        if active is not None:
            active.update(status="failed", completed_at=timestamp(), detail="Stage failed; please retry the analysis")
        store.save_analysis(analysis)


def chat_agent(store, analysis, question, previous_measurements):
    q = question.lower()
    unsafe = re.search(r"diagnos|prescri|treat|medicine|medication|dosage|\bdose\b|do i have|am i sick|\bcure\b|should i take|stop taking|disease|cancer|diabetes|heart attack", q)
    base = {"explanation_mode": "deterministic", "measurements": [], "evidence": [], "agents_used": ["Safety Router"]}
    if unsafe:
        return {**base, "answer": "I cannot diagnose a condition, recommend treatment, or tell you to change medication. I can explain recorded measurement changes and show their sources. Please discuss health concerns with a qualified healthcare professional."}
    # Each requested finding is re-retrieved and verified before it is explained.
    history = history_agent(store, analysis["patient_id"])
    current, _ = trend_agent(history["observations"])
    evidence = verification_agent(store, current)
    verified = [trend for trend in current if trend["verified"]]
    available = {trend["measurement"]: trend for trend in verified}
    prior = [name for name in previous_measurements if name in available]
    matched = [trend for trend in verified if mentions(q, trend["measurement"])]
    if not matched:
        for alias, canonical in ALIASES.items():
            if mentions(q, alias):
                matched.extend(trend for trend in verified if trend["base_measurement"] == canonical and trend not in matched)
    reason = ""
    if any(term in q for term in ("why", "evidence", "source", "said that", "explain that", "show me")) and prior and not matched:
        selected = [available[name] for name in prior]
    elif matched:
        selected = matched
    elif any(term in q for term in ("most", "largest", "biggest")):
        ranked = [trend for trend in verified if len(trend["observations"]) > 1 and trend["percentage_change"] is not None]
        if any(term in q for term in ("decrease", "decreased", "drop", "fell")):
            ranked = [trend for trend in ranked if trend["percentage_change"] < 0]
        elif any(term in q for term in ("increase", "increased", "rise", "rose")):
            ranked = [trend for trend in ranked if trend["percentage_change"] > 0]
        selected = sorted(ranked, key=lambda trend: abs(trend["percentage_change"]), reverse=True)[:1]
        reason = " Ranked by absolute percentage change among comparable measurements with nonzero baselines; this is not a ranking of medical importance."
    elif "stable" in q or "same" in q:
        selected = [trend for trend in verified if trend["direction"] == "Stable"]
        reason = " Stable means every adjacent change stays within 1% of its prior nonzero value (0.01 at zero), a descriptive tolerance rather than a clinical threshold."
    elif "increas" in q or "rising" in q or "went up" in q:
        selected = [trend for trend in verified if trend["direction"] == "Increasing"]
    elif "decreas" in q or "falling" in q or "went down" in q:
        selected = [trend for trend in verified if trend["direction"] == "Decreasing"]
    elif "fluctuat" in q:
        selected = [trend for trend in verified if trend["direction"] == "Fluctuating"]
    elif any(term in q for term in ("summar", "overview", "what changed", "health story")):
        selected = sorted([trend for trend in verified if trend["percentage_change"] is not None], key=lambda trend: abs(trend["percentage_change"]), reverse=True)[:3]
    else:
        return {**base, "agents_used": AGENT_NAMES[:3], "answer": "I can answer questions about recorded measurements: what changed most, which measurements increased consistently, what stayed stable, or the evidence for a named measurement. Choose one of these questions or name a measurement."}
    if "every year" in q or "each year" in q or "year after year" in q:
        decreasing = any(term in q for term in ("decreas", "falling", "went down"))
        def every_year(trend):
            if not trend["changes"] or not all(change["year_over_year"] for change in trend["changes"]):
                return False
            return all((current["value"] - previous["value"]) * (-1 if decreasing else 1)
                       > (abs(previous["value"]) * 0.01 if previous["value"] else 0.01) + 1e-12
                       for previous, current in zip(trend["observations"], trend["observations"][1:]))
        selected = [trend for trend in selected if every_year(trend)]
        reason += " Every-year matches require observations in consecutive years and a change beyond the descriptive tolerance in the requested direction at every interval; stable intervals and gaps do not qualify."
    ids = {trend["evidence_id"] for trend in selected}
    answer = explanation_agent(selected, history["patient"]["years"], summary=False)
    return {"answer": answer + reason, "measurements": [trend["measurement"] for trend in selected],
            "evidence": [item for item in evidence if item["id"] in ids],
            "agents_used": AGENT_NAMES, "explanation_mode": "deterministic"}
