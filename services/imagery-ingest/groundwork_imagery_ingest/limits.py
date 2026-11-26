"""County or AOI scope. A statewide polygon is refused before any download.

60_000 km² is provisional. Spec 04 says county or AOI only and does not give a
square-meter cap. PostGIS geography area is the API's check. This spherical
estimate is the CLI's check, with the same threshold. See OPEN-QUESTIONS.
"""

from __future__ import annotations

import math
import re
from typing import Any

from groundwork_imagery_ingest.errors import IngestError

MAX_INGEST_AOI_SQ_M = 60_000_000_000
_EARTH_RADIUS_M = 6_378_137.0
_COUNTY_FIPS = re.compile(r"^[0-9]{5}$")


def ring_area_sq_m(ring: list[tuple[float, float]]) -> float:
    if len(ring) < 4:
        return 0.0
    total = 0.0
    for (lon1, lat1), (lon2, lat2) in zip(ring, ring[1:]):
        total += math.radians(lon2 - lon1) * (
            2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2))
        )
    return abs(total * _EARTH_RADIUS_M * _EARTH_RADIUS_M / 2.0)


def geometry_area_sq_m(geometry: dict[str, Any]) -> float:
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if kind == "Polygon":
        return _polygon_area(coordinates)
    if kind == "MultiPolygon":
        if not isinstance(coordinates, list) or len(coordinates) == 0:
            raise IngestError("aoi_invalid")
        return sum(_polygon_area(polygon) for polygon in coordinates)
    raise IngestError("aoi_invalid")


def assert_ingest_scope(county_fips: str | None, aoi: dict[str, Any] | None) -> None:
    has_county = county_fips is not None and county_fips != ""
    has_aoi = aoi is not None
    if has_county and has_aoi:
        raise IngestError("scope_both")
    if not has_county and not has_aoi:
        raise IngestError("scope_missing")
    if has_county:
        if county_fips is None or _COUNTY_FIPS.fullmatch(county_fips) is None:
            raise IngestError("county_fips_invalid")
        # FIPS county code 000 is the state. One county is the widest live pull.
        if county_fips.endswith("000"):
            raise IngestError("state_fips")
        return
    if aoi is None:
        raise IngestError("scope_missing")
    area = geometry_area_sq_m(aoi)
    if area <= 0:
        raise IngestError("aoi_empty")
    if area > MAX_INGEST_AOI_SQ_M:
        raise IngestError("aoi_too_large")


def _polygon_area(coordinates: Any) -> float:
    if not isinstance(coordinates, list) or len(coordinates) == 0:
        raise IngestError("aoi_invalid")
    area = 0.0
    for index, ring in enumerate(coordinates):
        positions = _ring(ring)
        ring_area = ring_area_sq_m(positions)
        area = ring_area if index == 0 else area - ring_area
    if area <= 0:
        raise IngestError("aoi_empty")
    return area


def _ring(ring: Any) -> list[tuple[float, float]]:
    if not isinstance(ring, list) or len(ring) < 4:
        raise IngestError("aoi_invalid")
    positions: list[tuple[float, float]] = []
    for position in ring:
        if (
            not isinstance(position, list)
            or len(position) < 2
            or not isinstance(position[0], (int, float))
            or not isinstance(position[1], (int, float))
        ):
            raise IngestError("aoi_invalid")
        lon = float(position[0])
        lat = float(position[1])
        if lon < -180 or lon > 180 or lat < -90 or lat > 90:
            raise IngestError("aoi_invalid")
        positions.append((lon, lat))
    if positions[0] != positions[-1]:
        raise IngestError("aoi_invalid")
    return positions
