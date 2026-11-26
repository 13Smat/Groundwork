# CV service

Segmentation for AI takeoff assist. Spec 05. ADR 0016.

`CV_BACKEND=mock` is the default and the only mode CI runs. It returns a fixed polygon and does not download a model. `CV_BACKEND=sam2` constructs an adapter that raises before importing torch. There is no Modal client and no weight file in this repo.

## Run the mock

From the repo root, after `pnpm test:cv` has created `.venv-cv`:

```sh
PYTHONPATH=services/cv CV_BACKEND=mock .venv-cv/bin/python -m uvicorn groundwork_cv.main:app --host 127.0.0.1 --port 8090
```

`GET /healthz` returns the backend name. `POST /segment/prompt` takes `{chip, transform, points, box}` and returns `{polygons_px, gpu_seconds}`. `POST /segment/classes` is a stub and returns no polygons.

## Tests

`pnpm test:cv` installs the hashed pins in `requirements.txt` and runs pytest. Those tests do not need Postgres, MinIO, or rasterio.

The chip crop uses rasterio from `.venv-imagery`. `pnpm test:imagery-ingest` creates that venv. The imagery CI job then runs:

```sh
PYTHONPATH=services/cv .venv-imagery/bin/python -m unittest services/cv/tests/test_crop.py -v
```

The crop reads a local GeoTIFF. It does not receive an imagery URL.
