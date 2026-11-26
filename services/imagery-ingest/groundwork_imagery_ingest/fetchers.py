"""Pluggable tile fetchers.

The fixture fetcher reads a local GeoTIFF. NC ortho, Helene 2025, and NAIP
share one live downloader. It stays off unless GROUNDWORK_IMAGERY_LIVE_FETCH
is exactly "1", and even then it downloads a single HTTPS GeoTIFF from
GROUNDWORK_IMAGERY_TILE_URL. The spec does not publish a tile URL template,
so this code does not invent one. CI never sets the flag.
"""

from __future__ import annotations

import os
import shutil
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from groundwork_imagery_ingest.errors import IngestError
from groundwork_imagery_ingest.hosts import assert_geotiff_url
from groundwork_imagery_ingest.limits import assert_ingest_scope

LIVE_FETCH_ENV = "GROUNDWORK_IMAGERY_LIVE_FETCH"
TILE_URL_ENV = "GROUNDWORK_IMAGERY_TILE_URL"

# Spec 04: Helene 2025 is leaf-off and NAIP is leaf-on. A raster tag still wins.
PROGRAM_LEAF = {
    "nc_helene_2025": "off",
    "naip": "on",
    "nc_ortho": None,
}


@dataclass(frozen=True)
class FetchRequest:
    provider: str
    year: int
    county_fips: str | None
    aoi: dict[str, Any] | None
    fixture_path: Path | None


@dataclass(frozen=True)
class FetchedRaster:
    path: Path
    leaf: str | None


class Fetcher(Protocol):
    def fetch(self, request: FetchRequest, dest: Path) -> FetchedRaster: ...


class FixtureFetcher:
    def fetch(self, request: FetchRequest, dest: Path) -> FetchedRaster:
        assert_ingest_scope(request.county_fips, request.aoi)
        source = request.fixture_path
        if source is None or not source.is_file():
            raise IngestError("fixture_missing")
        shutil.copyfile(source, dest)
        return FetchedRaster(path=dest, leaf=None)


class ProgramFetcher:
    def __init__(self, provider: str) -> None:
        self.provider = provider

    def fetch(self, request: FetchRequest, dest: Path) -> FetchedRaster:
        assert_ingest_scope(request.county_fips, request.aoi)
        if os.environ.get(LIVE_FETCH_ENV) != "1":
            raise IngestError("live_fetch_disabled")
        raw = os.environ.get(TILE_URL_ENV, "").strip()
        if raw == "":
            raise IngestError("tile_url_missing")
        url = assert_geotiff_url(raw)
        _download_one(url, dest)
        return FetchedRaster(path=dest, leaf=PROGRAM_LEAF.get(self.provider))


def fetcher_for(provider: str) -> Fetcher:
    if provider == "fixture":
        return FixtureFetcher()
    if provider in PROGRAM_LEAF:
        return ProgramFetcher(provider)
    raise IngestError("unsupported_provider")


def _download_one(url: str, dest: Path) -> None:
    request = urllib.request.Request(url, headers={"user-agent": "groundwork-imagery-ingest"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, dest.open("wb") as handle:
            shutil.copyfileobj(response, handle)
    except IngestError:
        raise
    except Exception as error:
        raise IngestError("tile_download_failed") from error
