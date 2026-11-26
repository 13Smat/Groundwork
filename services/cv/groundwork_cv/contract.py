"""HTTP bodies for the internal CV service. Spec 05."""

from __future__ import annotations

import base64
import math
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def _finite(values: list[float], label: str) -> list[float]:
    if any(not math.isfinite(value) for value in values):
        raise ValueError(f"{label} must be finite.")
    return values


class PointPrompt(BaseModel):
    x: float
    y: float
    label: Literal[0, 1]

    @field_validator("x", "y")
    @classmethod
    def finite_coord(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Point coordinates must be finite.")
        return value


class PromptIn(BaseModel):
    chip: str
    transform: list[float] = Field(min_length=6, max_length=6)
    points: list[PointPrompt] = Field(max_length=32)
    box: list[float] | None = None

    @field_validator("chip")
    @classmethod
    def chip_bytes(cls, value: str) -> str:
        try:
            raw = base64.b64decode(value, validate=True)
        except Exception as error:
            raise ValueError("chip must be base64.") from error
        if len(raw) < 16:
            raise ValueError("chip is empty.")
        return value

    @field_validator("transform")
    @classmethod
    def finite_transform(cls, value: list[float]) -> list[float]:
        return _finite(value, "transform")

    @field_validator("box")
    @classmethod
    def finite_box(cls, value: list[float] | None) -> list[float] | None:
        if value is None:
            return None
        if len(value) != 4:
            raise ValueError("box must be four pixel coordinates.")
        _finite(value, "box")
        if value[2] <= value[0] or value[3] <= value[1]:
            raise ValueError("box must have a positive width and height.")
        return value


class PromptOut(BaseModel):
    polygons_px: list[list[list[float]]]
    gpu_seconds: float


class ClassesIn(BaseModel):
    chip: str
    transform: list[float] = Field(min_length=6, max_length=6)
    classes: list[str] = Field(max_length=16)

    @field_validator("chip")
    @classmethod
    def chip_bytes(cls, value: str) -> str:
        try:
            raw = base64.b64decode(value, validate=True)
        except Exception as error:
            raise ValueError("chip must be base64.") from error
        if len(raw) < 16:
            raise ValueError("chip is empty.")
        return value

    @field_validator("transform")
    @classmethod
    def finite_transform(cls, value: list[float]) -> list[float]:
        return _finite(value, "transform")

    @field_validator("classes")
    @classmethod
    def class_names(cls, value: list[str]) -> list[str]:
        for name in value:
            if name.strip() == "" or len(name) > 80:
                raise ValueError("class names must be 1 to 80 characters.")
        return value


class ClassesOut(BaseModel):
    polygons_px: dict[str, list[list[list[float]]]]
    scores: dict[str, list[float]]
    stub: Literal[True]
