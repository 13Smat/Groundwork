"""Hosts an ingest download must never contact.

The same suffixes live in apps/api/src/imagery/hosts.ts and in the tile guard.
ImageServers and WMS are refused even when the host is not on that list.
"""

from __future__ import annotations

from urllib.parse import urlparse

from groundwork_imagery_ingest.errors import IngestError

FORBIDDEN_HOST_SUFFIXES = (
    "googleapis.com",
    "google.com",
    "gstatic.com",
    "mapbox.com",
    "nconemap.gov",
    "arcgis.com",
)


def host_is_forbidden(hostname: str) -> bool:
    host = hostname.strip().lower().rstrip(".")
    if host == "":
        return True
    return any(host == suffix or host.endswith("." + suffix) for suffix in FORBIDDEN_HOST_SUFFIXES)


def assert_geotiff_url(url: str) -> str:
    parsed = urlparse(url.strip())
    host = parsed.hostname or ""
    path = parsed.path.lower()
    query = (parsed.query or "").lower()
    combined = f"{path}?{query}"
    if (
        parsed.scheme != "https"
        or host == ""
        or parsed.username
        or parsed.password
        or not (path.endswith(".tif") or path.endswith(".tiff"))
        or host_is_forbidden(host)
        or "imageserver" in combined
        or "/wms" in combined
        or "request=getmap" in combined
        or "service=wms" in combined
    ):
        if host_is_forbidden(host) or "imageserver" in combined or "/wms" in combined:
            raise IngestError("tile_host_forbidden")
        raise IngestError("tile_url_invalid")
    return url.strip()
