"""FastAPI app. CV_BACKEND=mock by default. sam2 fails closed without a download."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException

from groundwork_cv.contract import ClassesIn, ClassesOut, PromptIn, PromptOut
from groundwork_cv.segmenter import Segmenter, backend_name, build_segmenter

_cached: tuple[str, Segmenter] | None = None


def get_segmenter() -> Segmenter:
    global _cached
    name = backend_name()
    if _cached is None or _cached[0] != name:
        _cached = (name, build_segmenter(name))
    return _cached[1]


def reset_segmenter() -> None:
    """Tests change CV_BACKEND and need a new instance."""
    global _cached
    _cached = None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    get_segmenter()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "backend": backend_name()}


@app.post("/segment/prompt", response_model=PromptOut)
def segment_prompt(body: PromptIn) -> PromptOut:
    try:
        return get_segmenter().segment_prompt(body)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/segment/classes", response_model=ClassesOut)
def segment_classes(body: ClassesIn) -> ClassesOut:
    return get_segmenter().segment_classes(body)
