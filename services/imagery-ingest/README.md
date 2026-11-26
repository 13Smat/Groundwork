# Imagery ingest

Python worker that turns one county or AOI GeoTIFF into a 4-band COG and uploads it to the bucket. ADR 0008.

`groundwork_imagery_ingest` reads the local fixture GeoTIFF, or one HTTPS GeoTIFF when `GROUNDWORK_IMAGERY_LIVE_FETCH` is `1` and `GROUNDWORK_IMAGERY_TILE_URL` is set. It refuses Google, Mapbox, NC OneMap, ArcGIS, ImageServer, and WMS hosts. It does not embed a portal URL. CI runs `pnpm test:imagery-ingest` against the fixture only.

The pg-boss worker in `apps/api` spawns `python -m groundwork_imagery_ingest`. Hashed dependencies are in `requirements.txt`. The image digest is pinned in the Dockerfile.
