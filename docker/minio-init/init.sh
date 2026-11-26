#!/bin/sh
# Create the local bucket. Retries until MinIO accepts the alias.
set -eu

endpoint="${MINIO_ENDPOINT:-http://minio:9000}"
user="${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
password="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
bucket="${MINIO_BUCKET:?MINIO_BUCKET is required}"

attempt=0
until mc alias set local "$endpoint" "$user" "$password"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 30 ]; then
    echo "MinIO did not accept a connection at ${endpoint}." >&2
    exit 1
  fi
  sleep 1
done

mc mb --ignore-existing "local/${bucket}"
echo "bucket ${bucket} is ready"
