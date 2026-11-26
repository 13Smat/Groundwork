# Tiles

TiTiler (FastAPI) serves XYZ tiles from Cloud Optimized GeoTIFFs in our bucket. The dataset URL is not a request parameter. Callers pass a capture id and a short-lived HMAC. The service loads the capture with the `groundwork_app` role and returns 403 when `allows_tracing` is false or `verified_at` is null. It reads `/vsis3/{bucket}/{cog_key}` and will not open a Google, Mapbox, NC OneMap, or ArcGIS host.

The office API proxies `GET /imagery/tiles/:captureId/{z}/{x}/{y}` to this service. Auth is not wired yet. The API uses the stub in `apps/api/src/auth/hook.ts` until Auth and Workspaces replaces it.

Local compose builds this image and publishes it on `127.0.0.1:8080`. The signing secret in `docker-compose.yml` is the laptop default. `NODE_ENV=production` refuses that default.

A synthetic 4-band fixture lives in `db/seed/fixtures/`. Tests upload it to MinIO. Nothing in this service downloads NC OneMap.
