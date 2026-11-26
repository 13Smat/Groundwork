# County and AOI ingest. CI runs the venv from requirements.txt and does not
# download a live tile. Index digest checked 2026-11-26 against
# registry-1.docker.io library/python:3.12-slim-bookworm
# (Docker-Content-Digest and hub.docker.com tag digest).
# linux/amd64 manifest sha256:1475c4f5b6bcb7d35e57661d6f5d7429ec4041275633c15f2b49350ac898276d
FROM python:3.12-slim-bookworm@sha256:44cf1793efa7c7a476bb0f2cff81443f4a072c90c1cb127e2924933daa3e8c64

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --require-hashes -r /app/requirements.txt
COPY groundwork_imagery_ingest /app/groundwork_imagery_ingest
ENV PYTHONPATH=/app
ENTRYPOINT ["python", "-m", "groundwork_imagery_ingest"]
