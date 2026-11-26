"""Crop a chip from a COG we already stored.

The bbox is the site boundary plus the caller's buffer, in EPSG:4326.
The longest side is at most 4096 px. Pixels are read from a local GeoTIFF
(the API downloads the object from MinIO first) or from /vsis3. A caller
cannot pass an imagery URL. Google, Mapbox, OneMap, and ArcGIS hosts are
refused before any raster opens.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import re
from pathlib import Path
from urllib.parse import urlparse

MAX_SIDE = 4096
FORBIDDEN_HOST_SUFFIXES = (
    "googleapis.com",
    "google.com",
    "gstatic.com",
    "mapbox.com",
    "nconemap.gov",
    "arcgis.com",
)
_COG_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/\-]*\.(tif|tiff)$", re.IGNORECASE)


class ChipError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def host_is_forbidden(hostname: str) -> bool:
    host = hostname.strip().lower().rstrip(".")
    if host == "":
        return True
    return any(host == suffix or host.endswith("." + suffix) for suffix in FORBIDDEN_HOST_SUFFIXES)


def assert_cog_key(key: str) -> str:
    if (
        not _COG_KEY.fullmatch(key)
        or ".." in key
        or "\\" in key
        or "://" in key
        or key.startswith("/")
    ):
        raise ChipError("cog_key_invalid")
    lowered = key.lower()
    for suffix in FORBIDDEN_HOST_SUFFIXES:
        if suffix in lowered:
            raise ChipError("cog_key_invalid")
    return key


def assert_storage_endpoint(endpoint: str) -> str:
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ChipError("storage_forbidden")
    if host_is_forbidden(parsed.hostname):
        raise ChipError("storage_forbidden")
    if parsed.port is None:
        return parsed.hostname
    return f"{parsed.hostname}:{parsed.port}"


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius = 6_378_137.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = p2 - p1
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def crop_chip(
    source: str,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    max_side: int = MAX_SIDE,
) -> dict[str, object]:
    """Window `source` to the bbox. `source` is a filesystem path or /vsis3/."""
    if not (west < east and south < north):
        raise ChipError("chip_outside")
    if max_side < 1 or max_side > MAX_SIDE:
        raise ChipError("cog_unreadable")

    import rasterio
    from rasterio.enums import Resampling
    from rasterio.errors import WindowError
    from rasterio.io import MemoryFile
    from rasterio.transform import Affine
    from rasterio.warp import transform as warp_transform
    from rasterio.warp import transform_bounds
    from rasterio.windows import Window
    from rasterio.windows import from_bounds

    try:
        with rasterio.open(source) as src:
            if src.crs is None:
                raise ChipError("cog_unreadable")
            epsg = src.crs.to_epsg()
            if epsg is None:
                raise ChipError("cog_unreadable")
            left, bottom, right, top = transform_bounds(
                "EPSG:4326", src.crs, west, south, east, north, densify_pts=21
            )
            window = from_bounds(left, bottom, right, top, transform=src.transform)
            try:
                window = window.intersection(Window(0, 0, src.width, src.height))
            except WindowError as error:
                raise ChipError("chip_outside") from error
            window = window.round_offsets().round_lengths()
            if window.width < 1 or window.height < 1:
                raise ChipError("chip_outside")
            scale = 1.0
            longest = max(window.width, window.height)
            if longest > max_side:
                scale = max_side / longest
            out_w = max(1, min(max_side, int(round(window.width * scale))))
            out_h = max(1, min(max_side, int(round(window.height * scale))))
            indexes = [1, 2, 3] if src.count >= 3 else [1]
            data = src.read(
                indexes=indexes,
                window=window,
                out_shape=(len(indexes), out_h, out_w),
                resampling=Resampling.bilinear,
                boundless=False,
            )
            if data.shape[0] == 1:
                data = data.repeat(3, axis=0)
            transform = src.window_transform(window) @ Affine.scale(
                window.width / out_w, window.height / out_h
            )
            xs, ys = warp_transform(src.crs, "EPSG:4326", [transform.c, transform.c + transform.a], [transform.f, transform.f + transform.d])
    except ChipError:
        raise
    except Exception as error:
        raise ChipError("cog_unreadable") from error

    ground_pixel_m = _haversine_m(xs[0], ys[0], xs[1], ys[1])
    if not math.isfinite(ground_pixel_m) or ground_pixel_m <= 0:
        raise ChipError("cog_unreadable")

    import numpy

    rgb = numpy.clip(data, 0, 255).astype("uint8")
    with MemoryFile() as mem:
        with mem.open(
            driver="PNG",
            width=out_w,
            height=out_h,
            count=3,
            dtype="uint8",
        ) as dst:
            dst.write(rgb)
        mem.seek(0)
        png = mem.read()

    return {
        "width": out_w,
        "height": out_h,
        "crs_epsg": int(epsg),
        "transform": [float(transform.a), float(transform.b), float(transform.c), float(transform.d), float(transform.e), float(transform.f)],
        "ground_pixel_m": ground_pixel_m,
        "chip_base64": base64.b64encode(png).decode("ascii"),
    }


def _open_vsis3(bucket: str, key: str, endpoint: str) -> str:
    hostport = assert_storage_endpoint(endpoint)
    parsed = urlparse(endpoint)
    import os

    import rasterio

    os.environ["AWS_ACCESS_KEY_ID"] = os.environ.get("S3_ACCESS_KEY_ID", "")
    os.environ["AWS_SECRET_ACCESS_KEY"] = os.environ.get("S3_SECRET_ACCESS_KEY", "")
    os.environ["AWS_S3_ENDPOINT"] = hostport
    os.environ["AWS_HTTPS"] = "YES" if parsed.scheme == "https" else "NO"
    os.environ["AWS_VIRTUAL_HOSTING"] = "FALSE"
    os.environ["AWS_S3_ADDRESSING_STYLE"] = "path"
    os.environ["AWS_REGION"] = os.environ.get("S3_REGION", "us-east-1") or "us-east-1"
    os.environ["GDAL_DISABLE_READDIR_ON_OPEN"] = "EMPTY_DIR"
    os.environ["CPL_VSIL_CURL_ALLOWED_EXTENSIONS"] = ".tif,.tiff,.TIF,.TIFF"
    if not hasattr(rasterio, "open"):
        raise ChipError("cog_unreadable")
    return f"/vsis3/{bucket}/{key}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--cog", help="Local GeoTIFF path. The API downloads the MinIO object here.")
    source.add_argument("--cog-key", help="Object key. Requires S3_* in the environment.")
    parser.add_argument("--west", type=float, required=True)
    parser.add_argument("--south", type=float, required=True)
    parser.add_argument("--east", type=float, required=True)
    parser.add_argument("--north", type=float, required=True)
    parser.add_argument("--max-side", type=int, default=MAX_SIDE)
    args = parser.parse_args(argv)
    try:
        if args.cog_key:
            import os

            key = assert_cog_key(args.cog_key)
            bucket = os.environ.get("S3_BUCKET", "").strip()
            endpoint = os.environ.get("S3_ENDPOINT", "").strip()
            if bucket == "" or endpoint == "":
                raise ChipError("cog_unreadable")
            path = _open_vsis3(bucket, key, endpoint)
        else:
            if args.cog.startswith(("http://", "https://", "s3://")):
                raise ChipError("cog_key_invalid")
            path = str(Path(args.cog))
        result = crop_chip(
            path,
            west=args.west,
            south=args.south,
            east=args.east,
            north=args.north,
            max_side=args.max_side,
        )
    except ChipError as error:
        print(json.dumps({"ok": False, "error": error.code}))
        return 1
    print(json.dumps({"ok": True, **result}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
