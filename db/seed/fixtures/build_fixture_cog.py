#!/usr/bin/env python3
"""Write the synthetic 4-band RGBIR fixture COG.

This is not a county and it is not downloaded from NC OneMap or any other
state service. Run it with rasterio, rio-cogeo, morecantile, and numpy when
the committed GeoTIFF needs to be regenerated:

    python3 db/seed/fixtures/build_fixture_cog.py

The tile is WebMercatorQuad z=16 over Burke County, North Carolina.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import morecantile
import numpy
import rasterio
from rasterio.transform import from_bounds
from rio_cogeo.cogeo import cog_translate, cog_validate
from rio_cogeo.profiles import cog_profiles

HERE = Path(__file__).resolve().parent
TILE_Z = 16
TILE_X = 17894
TILE_Y = 25791
SIZE = 256
COLOR = {"r": 220, "g": 30, "b": 40, "nir": 180}


def rounded(value: float) -> float:
    return float(f"{value:.12f}")


def main() -> None:
    tms = morecantile.tms.get("WebMercatorQuad")
    tile = morecantile.Tile(TILE_X, TILE_Y, TILE_Z)
    geo = tms.bounds(tile)
    xy = tms.xy_bounds(tile)
    west, south, east, north = (rounded(geo.left), rounded(geo.bottom), rounded(geo.right), rounded(geo.top))
    left, bottom, right, top = (rounded(xy.left), rounded(xy.bottom), rounded(xy.right), rounded(xy.top))

    data = numpy.zeros((4, SIZE, SIZE), dtype=numpy.uint8)
    data[0] = COLOR["r"]
    data[1] = COLOR["g"]
    data[2] = COLOR["b"]
    data[3] = COLOR["nir"]

    tmp = HERE / "rgbir-cog.uncompressed.tif"
    dst = HERE / "rgbir-cog.tif"
    transform = from_bounds(left, bottom, right, top, SIZE, SIZE)
    with rasterio.open(
        tmp,
        "w",
        driver="GTiff",
        height=SIZE,
        width=SIZE,
        count=4,
        dtype="uint8",
        crs="EPSG:3857",
        transform=transform,
    ) as dataset:
        dataset.write(data)
        dataset.set_band_description(1, "Red")
        dataset.set_band_description(2, "Green")
        dataset.set_band_description(3, "Blue")
        dataset.set_band_description(4, "NIR")

    profile = cog_profiles.get("deflate")
    profile.update(blocksize=256)
    cog_translate(tmp, dst, profile, indexes=(1, 2, 3, 4), overview_level=0, quiet=True, web_optimized=False)
    tmp.unlink()

    valid, errors, warnings = cog_validate(dst)
    if not valid:
        raise SystemExit(f"fixture COG failed validation: {errors} {warnings}")

    width_m = right - left
    lat_mid = (south + north) / 2
    gsd_cm = round(width_m * math.cos(math.radians(lat_mid)) / SIZE * 100, 2)
    document = {
        "key": "imagery/fixtures/rgbir-cog.tif",
        "tile": {"z": TILE_Z, "x": TILE_X, "y": TILE_Y},
        "bounds": {"west": west, "south": south, "east": east, "north": north},
        "mercator": {"left": left, "bottom": bottom, "right": right, "top": top},
        "bands": 4,
        "color": COLOR,
        "gsdCm": gsd_cm,
        "width": SIZE,
        "height": SIZE,
    }
    (HERE / "rgbir-cog.json").write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {dst} ({dst.stat().st_size} bytes), gsd_cm={gsd_cm}")


if __name__ == "__main__":
    main()
