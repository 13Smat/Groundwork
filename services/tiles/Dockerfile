# Groundwork tile service. The base image is the TiTiler tag ADR 0005 checked.
# pg8000 is pure Python so this image's Python does not need a binary wheel.
FROM ghcr.io/developmentseed/titiler:2.0.5

RUN python -m pip install --no-cache-dir 'pg8000==1.31.6'

WORKDIR /app
COPY groundwork_tiles /app/groundwork_tiles
ENV PYTHONPATH=/app
ENV PORT=80
ENV WEB_CONCURRENCY=1
EXPOSE 80
CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "groundwork_tiles.main:app", "--bind", "0.0.0.0:80", "--workers", "1"]
