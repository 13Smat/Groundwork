"""Deterministic stand-in for SAM 2.

A positive point becomes a 32 px square. A box is returned as that rectangle.
A second ring, 0.8 px on a side, is always included so the API can drop a
sliver under 2 m². No weights are loaded and no pixels are inspected.
"""

from __future__ import annotations

from groundwork_cv.contract import ClassesIn, ClassesOut, PointPrompt, PromptIn, PromptOut

SQUARE_PX = 32.0
SLIVER_LEG_PX = 0.8


def _ring(x0: float, y0: float, x1: float, y1: float) -> list[list[float]]:
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]


def _sliver(x: float, y: float) -> list[list[float]]:
    leg = SLIVER_LEG_PX
    return [[x, y], [x + leg, y], [x, y + leg], [x, y]]


def polygons_px(points: list[PointPrompt], box: list[float] | None) -> list[list[list[float]]]:
    if box is not None:
        x0, y0, x1, y1 = box
        main = _ring(x0, y0, x1, y1)
        anchor = (x0, y0)
    else:
        positive = [point for point in points if point.label == 1]
        if not positive:
            raise ValueError("A prompt needs a box or a positive point.")
        point = positive[0]
        half = SQUARE_PX / 2
        main = _ring(point.x - half, point.y - half, point.x + half, point.y + half)
        anchor = (point.x, point.y)
    return [main, _sliver(anchor[0], anchor[1])]


class MockSegmenter:
    def segment_prompt(self, body: PromptIn) -> PromptOut:
        try:
            rings = polygons_px(body.points, body.box)
        except ValueError as error:
            raise ValueError(str(error)) from error
        return PromptOut(polygons_px=rings, gpu_seconds=0)

    def segment_classes(self, body: ClassesIn) -> ClassesOut:
        return ClassesOut(
            polygons_px={name: [] for name in body.classes},
            scores={name: [] for name in body.classes},
            stub=True,
        )
