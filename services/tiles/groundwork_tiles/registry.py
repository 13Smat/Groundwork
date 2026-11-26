"""Read one capture under row level security and apply the license gate."""

from __future__ import annotations

from dataclasses import dataclass

import pg8000.dbapi
from fastapi import HTTPException

from groundwork_tiles.config import Settings, database_connect_kwargs
from groundwork_tiles.guard import assert_cog_key, vsis3_path


@dataclass(frozen=True)
class ServeableCapture:
    cog_path: str


def resolve_capture(settings: Settings, capture_id: str, workspace_id: str) -> ServeableCapture:
    """Return the in-bucket COG path, or raise 401/403/404/500.

    Connects as the configured app role. A superuser or BYPASSRLS role is refused
    even though the license flags are also checked in this function.
    """
    try:
        conn = pg8000.dbapi.connect(**database_connect_kwargs(settings.database_url))
    except Exception as error:  # noqa: BLE001 - driver errors must not leak the URL
        raise HTTPException(status_code=500, detail="Tile service could not reach the registry.") from error

    try:
        conn.autocommit = False
        cursor = conn.cursor()
        cursor.execute("set local statement_timeout = '5s'")
        cursor.execute(
            "select rolsuper, rolbypassrls from pg_roles where rolname = current_user"
        )
        role = cursor.fetchone()
        if role is None or role[0] or role[1]:
            raise HTTPException(
                status_code=500,
                detail="Tile service refuses a role that bypasses row security.",
            )
        cursor.execute("select set_config('app.workspace_id', %s, true)", (workspace_id,))
        cursor.execute(
            """
            select c.cog_key, c.status, s.allows_tracing, (s.verified_at is not null)
            from imagery_capture c
            join imagery_source s on s.id = c.source_id
            where c.id = %s::uuid
            """,
            (capture_id,),
        )
        row = cursor.fetchone()
        conn.rollback()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        raise HTTPException(status_code=500, detail="Tile service could not read the registry.") from error
    finally:
        conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="No imagery capture matches that id.")
    cog_key, status, allows_tracing, verified = row
    if not allows_tracing or not verified:
        raise HTTPException(
            status_code=403,
            detail="This imagery source cannot be used for measurement.",
        )
    if status != "ready" or not cog_key:
        raise HTTPException(status_code=404, detail="That capture has no readable COG.")
    try:
        key = assert_cog_key(str(cog_key))
        path = vsis3_path(settings.s3_bucket, key)
    except ValueError as error:
        raise HTTPException(status_code=404, detail="That capture has no readable COG.") from error
    return ServeableCapture(cog_path=path)
