"""CLI used by the pg-boss worker. Prints one JSON object on stdout."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from groundwork_imagery_ingest.errors import IngestError
from groundwork_imagery_ingest.fetchers import FetchRequest
from groundwork_imagery_ingest.pipeline import run_ingest
from groundwork_imagery_ingest.upload import S3Uploader


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest one imagery county or AOI to a COG.")
    parser.add_argument("--provider", required=True)
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--cog-key", required=True)
    parser.add_argument("--county-fips")
    parser.add_argument("--aoi-geojson")
    parser.add_argument("--fixture")
    args = parser.parse_args(argv)
    try:
        aoi = _load_aoi(args.aoi_geojson)
        report = run_ingest(
            FetchRequest(
                provider=args.provider,
                year=args.year,
                county_fips=args.county_fips,
                aoi=aoi,
                fixture_path=Path(args.fixture) if args.fixture else None,
            ),
            args.cog_key,
            S3Uploader(),
        )
    except IngestError as error:
        _write({"ok": False, "error": error.code})
        return 2
    except Exception:
        _write({"ok": False, "error": "ingest_failed"})
        return 1
    _write(report)
    return 0


def _load_aoi(raw: str | None) -> dict[str, Any] | None:
    if raw is None or raw.strip() == "":
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise IngestError("aoi_invalid") from error
    if not isinstance(parsed, dict):
        raise IngestError("aoi_invalid")
    return parsed


def _write(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
