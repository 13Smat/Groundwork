"""Contract tests for the mock CV service. No model and no network."""

from __future__ import annotations

import base64
import sys

import pytest
from fastapi.testclient import TestClient

from groundwork_cv.main import app, reset_segmenter
from groundwork_cv.sam2 import Sam2Segmenter
from groundwork_cv.segmenter import build_segmenter

CHIP = base64.b64encode(b"not-a-real-png!!").decode("ascii")
TRANSFORM = [1.0, 0.0, 0.0, 0.0, -1.0, 0.0]


@pytest.fixture(autouse=True)
def _mock_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CV_BACKEND", raising=False)
    reset_segmenter()


def test_health_reports_mock() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "backend": "mock"}


def test_prompt_point_is_deterministic() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/segment/prompt",
            json={
                "chip": CHIP,
                "transform": TRANSFORM,
                "points": [{"x": 10, "y": 20, "label": 1}],
                "box": None,
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["gpu_seconds"] == 0
    assert body["polygons_px"] == [
        [[-6.0, 4.0], [26.0, 4.0], [26.0, 36.0], [-6.0, 36.0], [-6.0, 4.0]],
        [[10.0, 20.0], [10.8, 20.0], [10.0, 20.8], [10.0, 20.0]],
    ]


def test_prompt_box_returns_the_rectangle_and_a_sliver() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/segment/prompt",
            json={
                "chip": CHIP,
                "transform": TRANSFORM,
                "points": [],
                "box": [0, 0, 10, 20],
            },
        )
    assert response.status_code == 200
    rings = response.json()["polygons_px"]
    assert rings[0] == [[0.0, 0.0], [10.0, 0.0], [10.0, 20.0], [0.0, 20.0], [0.0, 0.0]]
    assert rings[1] == [[0.0, 0.0], [0.8, 0.0], [0.0, 0.8], [0.0, 0.0]]


def test_prompt_without_a_positive_point_or_box_is_rejected() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/segment/prompt",
            json={
                "chip": CHIP,
                "transform": TRANSFORM,
                "points": [{"x": 1, "y": 1, "label": 0}],
            },
        )
    assert response.status_code == 422


def test_prompt_rejects_an_empty_chip() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/segment/prompt",
            json={"chip": base64.b64encode(b"short").decode("ascii"), "transform": TRANSFORM, "points": []},
        )
    assert response.status_code == 422


def test_classes_stub_returns_no_polygons() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/segment/classes",
            json={"chip": CHIP, "transform": TRANSFORM, "classes": ["asphalt", "turf"]},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["stub"] is True
    assert body["polygons_px"] == {"asphalt": [], "turf": []}
    assert body["scores"] == {"asphalt": [], "turf": []}


def test_same_prompt_repeats() -> None:
    payload = {
        "chip": CHIP,
        "transform": TRANSFORM,
        "points": [{"x": 4, "y": 5, "label": 1}, {"x": 1, "y": 1, "label": 0}],
    }
    with TestClient(app) as client:
        first = client.post("/segment/prompt", json=payload)
        second = client.post("/segment/prompt", json=payload)
    assert first.json() == second.json()


def test_mock_does_not_import_torch() -> None:
    assert "torch" not in sys.modules
    build_segmenter("mock")
    assert "torch" not in sys.modules


def test_sam2_refuses_without_a_download() -> None:
    assert "torch" not in sys.modules
    with pytest.raises(RuntimeError, match="No model is downloaded"):
        Sam2Segmenter()
    with pytest.raises(RuntimeError, match="No model is downloaded"):
        build_segmenter("sam2")
    assert "torch" not in sys.modules


def test_unknown_backend_is_rejected() -> None:
    with pytest.raises(ValueError, match="mock or sam2"):
        build_segmenter("modal")
