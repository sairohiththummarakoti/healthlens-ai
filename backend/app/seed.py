"""Versioned, invented observations, never represented as external patient records."""

SOURCE = "HealthLens synthetic demonstration fixture v1"
METRICS = {
    "LDL": ("mg/dL", [105, 118, 132]),
    "HDL": ("mg/dL", [52, 54, 56]),
    "Total Cholesterol": ("mg/dL", [185, 199, 214]),
    "Triglycerides": ("mg/dL", [140, 128, 115]),
    "Glucose": ("mg/dL", [92, 96, 101]),
    "HbA1c": ("%", [5.2, 5.3, 5.5]),
    "Systolic Blood Pressure": ("mmHg", [118, 121, 125]),
    "Diastolic Blood Pressure": ("mmHg", [76, 77, 79]),
    "BMI": ("kg/m²", [24.1, 24.6, 25.2]),
    "Weight": ("kg", [70, 71.5, 73.2]),
    "Resting Heart Rate": ("bpm", [72, 70, 68]),
    "Hemoglobin": ("g/dL", [14.2, 14.3, 14.2]),
    "Creatinine": ("mg/dL", [0.9, 0.9, 0.9]),
    "Vitamin D": ("ng/mL", [24, 29, 34]),
    "TSH": ("mIU/L", [2.1, 2.2, 2.0]),
    "ALT": ("U/L", [24, 28, 25]),
    "AST": ("U/L", [22, 22.1, 22]),
    "Platelets": ("10³/µL", [245, 246, 244]),
}


def seed_records():
    records = []
    for patient_index in range(3):
        patient_id = f"PAT-{patient_index + 1:03d}"
        for metric_index, (measurement, (unit, values)) in enumerate(METRICS.items()):
            for year_index, value in enumerate(values):
                if patient_index == 1:
                    value = values[2 - year_index] * 0.94
                elif patient_index == 2:
                    value = values[0] * [1, 1.003, 0.998][year_index]
                records.append({
                    "id": f"fixture-{patient_id}-{metric_index:02d}-{2024 + year_index}",
                    "patient_id": patient_id, "date": f"{2024 + year_index}-03-15",
                    "measurement": measurement, "value": round(value, 3), "unit": unit,
                    "reference_range": None, "source": SOURCE,
                })
    return records
