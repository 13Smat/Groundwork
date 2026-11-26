"""Pick the segmentation backend. mock is the only backend CI constructs."""

from __future__ import annotations

import os
from typing import Protocol

from groundwork_cv.contract import ClassesIn, ClassesOut, PromptIn, PromptOut
from groundwork_cv.mock import MockSegmenter


class Segmenter(Protocol):
    def segment_prompt(self, body: PromptIn) -> PromptOut: ...

    def segment_classes(self, body: ClassesIn) -> ClassesOut: ...


def backend_name() -> str:
    value = os.environ.get("CV_BACKEND", "mock").strip()
    return value or "mock"


def build_segmenter(backend: str | None = None) -> Segmenter:
    name = backend_name() if backend is None else backend
    if name == "mock":
        return MockSegmenter()
    if name == "sam2":
        from groundwork_cv.sam2 import Sam2Segmenter

        return Sam2Segmenter()
    raise ValueError(f"CV_BACKEND must be mock or sam2. Received {name}.")
