"""Process settings. Read from the environment. No defaults that point at a public host."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

from groundwork_tiles.guard import host_is_forbidden

LOCAL_TILE_SIGNING_SECRET = "local-tile-signing-secret"


@dataclass(frozen=True)
class Settings:
    database_url: str
    signing_secret: str
    s3_endpoint: str
    s3_bucket: str
    s3_access_key_id: str
    s3_secret_access_key: str
    s3_region: str
    s3_use_https: bool
    s3_hostport: str


def load_settings() -> Settings:
    database_url = _required("APP_DATABASE_URL")
    parsed_db = urlparse(database_url)
    if parsed_db.scheme not in {"postgres", "postgresql"} or not parsed_db.hostname:
        raise RuntimeError("APP_DATABASE_URL must be a postgres URL.")
    if host_is_forbidden(parsed_db.hostname):
        raise RuntimeError("APP_DATABASE_URL host is not allowed.")

    secret = _required("TILE_SIGNING_SECRET")
    if len(secret) < 16:
        raise RuntimeError("TILE_SIGNING_SECRET must be at least 16 characters.")
    if os.environ.get("NODE_ENV") == "production" and secret == LOCAL_TILE_SIGNING_SECRET:
        raise RuntimeError(
            "TILE_SIGNING_SECRET must not be the local default when NODE_ENV is production."
        )

    endpoint = _required("S3_ENDPOINT")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimeError("S3_ENDPOINT must be an http(s) URL.")
    if host_is_forbidden(parsed.hostname):
        raise RuntimeError(f"Refusing object storage host {parsed.hostname}.")
    hostport = parsed.hostname if parsed.port is None else f"{parsed.hostname}:{parsed.port}"

    bucket = _required("S3_BUCKET")
    return Settings(
        database_url=database_url,
        signing_secret=secret,
        s3_endpoint=endpoint,
        s3_bucket=bucket,
        s3_access_key_id=_required("S3_ACCESS_KEY_ID"),
        s3_secret_access_key=_required("S3_SECRET_ACCESS_KEY"),
        s3_region=os.environ.get("S3_REGION", "us-east-1").strip() or "us-east-1",
        s3_use_https=parsed.scheme == "https",
        s3_hostport=hostport,
    )


def gdal_config(settings: Settings) -> dict[str, str]:
    """GDAL/rasterio settings that can only see the configured bucket endpoint."""
    return {
        "AWS_ACCESS_KEY_ID": settings.s3_access_key_id,
        "AWS_SECRET_ACCESS_KEY": settings.s3_secret_access_key,
        "AWS_S3_ENDPOINT": settings.s3_hostport,
        "AWS_HTTPS": "YES" if settings.s3_use_https else "NO",
        "AWS_VIRTUAL_HOSTING": "FALSE",
        "AWS_S3_ADDRESSING_STYLE": "path",
        "AWS_REGION": settings.s3_region,
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
        "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.tiff,.TIF,.TIFF",
        "GDAL_HTTP_MAX_RETRY": "1",
        "VSI_CACHE": "TRUE",
    }


def database_connect_kwargs(database_url: str) -> dict[str, object]:
    parsed = urlparse(database_url)
    return {
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 5432,
        "database": parsed.path.lstrip("/"),
    }


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required.")
    return value
