"""Validated source records. Values are bounded to keep every arithmetic result finite."""

from datetime import date as calendar_date
import math
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


def clean_text(value: Any, field: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    value = value.strip()
    if not value or len(value) > limit or any(ord(char) < 32 for char in value):
        raise ValueError(f"{field} must contain 1–{limit} printable characters")
    return value


class Observation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    patient_id: str
    date: str
    measurement: str
    value: float
    unit: str
    reference_range: str | None = None
    source: str
    source_record_id: str | None = None

    @field_validator("patient_id", mode="before")
    @classmethod
    def patient_id_valid(cls, value):
        if isinstance(value, int) and not isinstance(value, bool):
            value = str(value)
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", value.strip()):
            raise ValueError("patient_id must be 1–80 letters, digits, dots, hyphens or underscores")
        return value.strip()

    @field_validator("date", mode="before")
    @classmethod
    def date_valid(cls, value):
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("date must be an ISO calendar date (YYYY-MM-DD)")
        calendar_date.fromisoformat(value)
        return value

    @field_validator("value", mode="before")
    @classmethod
    def numeric_valid(cls, value):
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            raise ValueError("value must be numeric")
        try:
            number = float(value)
        except (ValueError, OverflowError):
            raise ValueError("value must be numeric") from None
        if not math.isfinite(number) or abs(number) > 1e12:
            raise ValueError("value must be finite and between -1e12 and 1e12")
        return number

    @field_validator("measurement", mode="before")
    @classmethod
    def measurement_valid(cls, value):
        return clean_text(value, "measurement", 100)

    @field_validator("unit", mode="before")
    @classmethod
    def unit_valid(cls, value):
        return clean_text(value, "unit", 40)

    @field_validator("reference_range", mode="before")
    @classmethod
    def range_valid(cls, value):
        return None if value in (None, "") else clean_text(value, "reference_range", 100)

    @field_validator("source_record_id", mode="before")
    @classmethod
    def source_record_valid(cls, value):
        return None if value in (None, "") else clean_text(value, "source_record_id", 300)


class ChatRequest(BaseModel):
    analysis_id: str = Field(min_length=1, max_length=80)
    question: str = Field(min_length=1, max_length=2000)
    previous_measurements: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("question")
    @classmethod
    def question_valid(cls, value):
        return clean_text(value, "question", 2000)
