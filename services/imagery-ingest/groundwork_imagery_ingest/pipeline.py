"""Fetch one county or AOI, write a 4-band COG, and upload it."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from groundwork_imagery_ingest.cog import assert_cog_key, convert_to_cog, read_capture_fields
from groundwork_imagery_ingest.fetchers import FetchRequest, fetcher_for
from groundwork_imagery_ingest.upload import ObjectUploader


def run_ingest(request: FetchRequest, cog_key: str, uploader: ObjectUploader) -> dict[str, Any]:
    assert_cog_key(cog_key)
    with tempfile.TemporaryDirectory(prefix="groundwork-ingest-") as tmp:
        directory = Path(tmp)
        source = directory / "source.tif"
        cog = directory / "cog.tif"
        fetched = fetcher_for(request.provider).fetch(request, source)
        fields = read_capture_fields(source, fetched.leaf)
        convert_to_cog(source, cog, fields["capture_date"], fields["leaf"])
        uploader.put(cog_key, cog)
    return {
        "ok": True,
        "gsd_cm": fields["gsd_cm"],
        "bands": "RGBIR",
        "capture_date": fields["capture_date"],
        "leaf": fields["leaf"],
        "cog_key": cog_key,
        "footprint": fields["footprint"],
        "band_count": 4,
    }
