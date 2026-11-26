"""Turn a 4-band GeoTIFF into a COG without dropping NIR.

The raster stays in its source CRS. TiTiler reprojects. The footprint reported
to the API is EPSG:4326. Spec 04.
"""

from __future__ import annotations

import math
import re
from datetime import date
from pathlib import Path
from typing import Any

import numpy
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import transform as warp_transform
from rio_cogeo.cogeo import cog_translate, cog_validate
from rio_cogeo.profiles import cog_profiles

from groundwork_imagery_ingest.errors import IngestError

LEAF_VALUES = {"on", "off", "mixed", "unknown"}
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_US_SURVEY_FOOT_M = 0.3048006096012192
_COG_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*\.(tif|tiff)$", re.IGNORECASE)


def assert_cog_key(key: str) -> None:
    if ".." in key or _COG_KEY.fullmatch(key) is None:
        raise IngestError("cog_key_invalid")


def write_solid_geotiff(
    path: Path,
    *,
    width: int,
    height: int,
    crs: str,
    bounds: tuple[float, float, float, float],
    color: tuple[int, int, int, int],
    capture_date: str,
    leaf: str,
) -> None:
    """Write a stripped 4-band GeoTIFF. It is not a COG."""
    data = numpy.zeros((4, height, width), dtype=numpy.uint8)
    for index, value in enumerate(color):
        data[index] = value
    left, bottom, right, top = bounds
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=4,
        dtype="uint8",
        crs=crs,
        transform=from_bounds(left, bottom, right, top, width, height),
    ) as dataset:
        dataset.write(data)
        dataset.set_band_description(1, "Red")
        dataset.set_band_description(2, "Green")
        dataset.set_band_description(3, "Blue")
        dataset.set_band_description(4, "NIR")
        dataset.update_tags(CAPTURE_DATE=capture_date, LEAF=leaf)


def read_capture_fields(path: Path, leaf_default: str | None) -> dict[str, Any]:
    with rasterio.open(path) as dataset:
        if dataset.count != 4:
            raise IngestError("not_four_bands")
        tags = {str(key).upper(): str(value) for key, value in dataset.tags().items()}
        capture_date = tags.get("CAPTURE_DATE", "")
        if not _valid_date(capture_date):
            raise IngestError("missing_capture_date")
        leaf = tags.get("LEAF", "").lower()
        if leaf not in LEAF_VALUES:
            leaf = leaf_default or ""
        if leaf not in LEAF_VALUES:
            raise IngestError("missing_leaf")
        return {
            "capture_date": capture_date,
            "leaf": leaf,
            "gsd_cm": gsd_cm(dataset),
            "footprint": footprint_4326(dataset),
            "nir": int(dataset.read(4)[dataset.height // 2, dataset.width // 2]),
        }


def convert_to_cog(src: Path, dst: Path, capture_date: str, leaf: str) -> None:
    profile = cog_profiles.get("deflate")
    profile.update(blocksize=256)
    cog_translate(
        src,
        dst,
        profile,
        indexes=(1, 2, 3, 4),
        overview_level=0,
        quiet=True,
        web_optimized=False,
        forward_band_tags=True,
        additional_cog_metadata={"CAPTURE_DATE": capture_date, "LEAF": leaf},
    )
    valid, _errors, _warnings = cog_validate(dst, quiet=True)
    if not valid:
        raise IngestError("cog_invalid")
    with rasterio.open(dst) as dataset:
        if dataset.count != 4:
            raise IngestError("not_four_bands")


def gsd_cm(dataset: rasterio.DatasetReader) -> float:
    pixel = abs(float(dataset.transform.a))
    crs = dataset.crs
    if pixel == 0 or crs is None:
        raise IngestError("gsd_unknown")
    epsg = crs.to_epsg()
    if epsg == 3857:
        center_x, center_y = dataset.xy(dataset.height / 2, dataset.width / 2)
        _lon, lat = warp_transform(crs, "EPSG:4326", [center_x], [center_y])
        meters = pixel * math.cos(math.radians(lat[0]))
    else:
        unit = (crs.linear_units or "").lower()
        if "foot" in unit:
            meters = pixel * _US_SURVEY_FOOT_M
        elif unit in {"metre", "meter", "m"}:
            meters = pixel
        elif crs.is_geographic:
            _x, center_lat = dataset.xy(dataset.height / 2, dataset.width / 2)
            meters = pixel * 111_320 * math.cos(math.radians(center_lat))
        else:
            raise IngestError("gsd_unknown")
    gsd = round(meters * 100, 2)
    if gsd <= 0 or gsd > 9999.99:
        raise IngestError("gsd_unknown")
    return gsd


def footprint_4326(dataset: rasterio.DatasetReader) -> dict[str, Any]:
    if dataset.crs is None:
        raise IngestError("footprint_invalid")
    bounds = dataset.bounds
    samples = 8
    xs = numpy.linspace(bounds.left, bounds.right, samples + 1)
    ys = numpy.linspace(bounds.bottom, bounds.top, samples + 1)
    edge: list[tuple[float, float]] = []
    edge.extend((float(x), float(bounds.top)) for x in xs)
    edge.extend((float(bounds.right), float(y)) for y in reversed(ys[:-1]))
    edge.extend((float(x), float(bounds.bottom)) for x in reversed(xs[:-1]))
    edge.extend((float(bounds.left), float(y)) for y in ys[:-1])
    edge.append(edge[0])
    lons, lats = warp_transform(
        dataset.crs,
        "EPSG:4326",
        [point[0] for point in edge],
        [point[1] for point in edge],
    )
    ring = [[round(float(lon), 8), round(float(lat), 8)] for lon, lat in zip(lons, lats)]
    ring[-1] = ring[0]
    return {"type": "Polygon", "coordinates": [ring]}


def _valid_date(value: str) -> bool:
    if _DATE.fullmatch(value) is None:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True
