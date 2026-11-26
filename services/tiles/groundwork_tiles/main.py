"""TiTiler app that serves XYZ tiles for one imagery capture.

The dataset URL is not a request parameter. The path is the capture id. The
handler checks the signature, then the registry, and only then opens an object
in the configured bucket. `allows_tracing = false` or a null `verified_at`
returns 403.
"""

from __future__ import annotations

import os
import time
from typing import Annotated
from uuid import UUID

from attrs import define
from fastapi import FastAPI, HTTPException, Path, Query, Request
from rio_tiler.io import BaseReader
from titiler.core.errors import DEFAULT_STATUS_CODES, add_exception_handlers
from titiler.core.factory import TilerFactory

from groundwork_tiles.config import Settings, gdal_config, load_settings
from groundwork_tiles.guard import (
    SIGNATURE_MAX_AGE_SECONDS,
    TILE_MATRIX_SET,
    reject_external_cog_url,
    sign_payload,
    signature_payload,
    signatures_match,
)
from groundwork_tiles.registry import resolve_capture
from groundwork_tiles.render import RgbReader

_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = load_settings()
        for key, value in gdal_config(_settings).items():
            os.environ[key] = value
    return _settings


def gdal_environment() -> dict[str, str]:
    # rasterio.Env rejects AWS_* ("credentials are handled exclusively by boto3").
    # Those options are written onto the process environment by get_settings so
    # GDAL's vsis3 still sees the MinIO endpoint. The Env only receives the rest.
    return {
        key: value
        for key, value in gdal_config(get_settings()).items()
        if not key.startswith("AWS_")
    }


def capture_cog_path(
    request: Request,
    capture_id: Annotated[UUID, Path()],
    workspaceId: Annotated[UUID, Query()],
    exp: Annotated[int, Query()],
    sig: Annotated[str, Query(min_length=20, max_length=200)],
) -> str:
    try:
        reject_external_cog_url([key for key, _value in request.query_params.multi_items()])
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    try:
        z = int(request.path_params["z"])
        x = int(request.path_params["x"])
        y = int(request.path_params["y"])
        tile_matrix_set = str(request.path_params["tileMatrixSetId"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail="Tile coordinates are required.") from error

    if tile_matrix_set != TILE_MATRIX_SET:
        raise HTTPException(status_code=404, detail="Only WebMercatorQuad tiles are served.")

    now = int(time.time())
    if exp < now or exp > now + SIGNATURE_MAX_AGE_SECONDS:
        raise HTTPException(status_code=401, detail="Tile signature is expired.")

    settings = get_settings()
    payload = signature_payload(str(capture_id), tile_matrix_set, z, x, y, str(workspaceId), exp)
    expected = sign_payload(payload, settings.signing_secret)
    if not signatures_match(expected, sig):
        raise HTTPException(status_code=401, detail="Tile signature is not valid.")

    resolved = resolve_capture(settings, str(capture_id), str(workspaceId))
    return resolved.cog_path


@define(kw_only=True)
class CaptureTiler(TilerFactory):
    """Only the tile route. Info, preview, and point would read pixels without a z/x/y signature."""

    reader: type[BaseReader] = RgbReader

    def register_routes(self) -> None:
        self.tile()


def build_app() -> FastAPI:
    app = FastAPI(title="Groundwork tiles", version="0.0.0")

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    tiler = CaptureTiler(
        path_dependency=capture_cog_path,
        environment_dependency=gdal_environment,
        router_prefix="/captures/{capture_id}",
    )
    app.include_router(tiler.router, prefix="/captures/{capture_id}")
    add_exception_handlers(app, DEFAULT_STATUS_CODES)
    return app


app = build_app()
