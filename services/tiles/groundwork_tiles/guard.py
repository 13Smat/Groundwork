"""License and storage guards for tile serving.

Stdlib only, so the unit tests run without GDAL. The API has the same host
list. A capture is served only when the source allows tracing and has been
verified. Object keys stay inside our bucket. State, Google, and Mapbox hosts
are refused.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
from urllib.parse import urlparse

FORBIDDEN_HOST_SUFFIXES = (
    "googleapis.com",
    "google.com",
    "gstatic.com",
    "mapbox.com",
    "nconemap.gov",
    "arcgis.com",
)

TILE_MATRIX_SET = "WebMercatorQuad"
SIGNATURE_TTL_SECONDS = 60
# The signer uses a 60s lifetime. Accept that plus 60s of clock skew, and
# nothing longer, so a stolen URL cannot be extended.
SIGNATURE_MAX_AGE_SECONDS = 120

COG_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/\-]*\.(tif|tiff)$", re.IGNORECASE)


def host_is_forbidden(hostname: str) -> bool:
    host = hostname.strip().lower().rstrip(".")
    if host == "":
        return True
    return any(host == suffix or host.endswith("." + suffix) for suffix in FORBIDDEN_HOST_SUFFIXES)


def assert_storage_endpoint(endpoint: str) -> str:
    """Return the GDAL host:port. Refuse a forbidden or non-http endpoint."""
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("S3_ENDPOINT must be an http(s) URL with a host.")
    if host_is_forbidden(parsed.hostname):
        raise ValueError(f"Refusing object storage host {parsed.hostname}.")
    if parsed.port is None:
        return parsed.hostname
    return f"{parsed.hostname}:{parsed.port}"


def assert_cog_key(key: str) -> str:
    if (
        not COG_KEY.fullmatch(key)
        or ".." in key
        or "\\" in key
        or "://" in key
        or key.startswith("/")
    ):
        raise ValueError("COG key must be a relative object key ending in .tif.")
    lowered = key.lower()
    for suffix in FORBIDDEN_HOST_SUFFIXES:
        if suffix in lowered:
            raise ValueError("COG key must not name a forbidden host.")
    return key


def reject_external_cog_url(query_keys: list[str]) -> None:
    """The tile route never accepts a caller-supplied dataset URL."""
    for key in query_keys:
        if key.lower() == "url":
            raise ValueError("COG URLs are not accepted.")


def signature_payload(
    capture_id: str,
    tile_matrix_set: str,
    z: int,
    x: int,
    y: int,
    workspace_id: str,
    expires_at: int,
) -> str:
    return ".".join(
        [
            capture_id.lower(),
            tile_matrix_set,
            str(z),
            str(x),
            str(y),
            workspace_id.lower(),
            str(expires_at),
        ]
    )


def sign_payload(payload: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return _b64url(digest)


def signatures_match(expected: str, presented: str) -> bool:
    if len(expected) != len(presented):
        return False
    return hmac.compare_digest(expected, presented)


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def vsis3_path(bucket: str, key: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]", bucket):
        raise ValueError("Bucket name is not an S3 bucket name.")
    assert_cog_key(key)
    return f"/vsis3/{bucket}/{key}"
