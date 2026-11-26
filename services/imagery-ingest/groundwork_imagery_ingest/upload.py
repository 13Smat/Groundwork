"""Upload a COG to MinIO or S3. Credentials come from the environment, not argv."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol

from groundwork_imagery_ingest.errors import IngestError


class ObjectUploader(Protocol):
    def put(self, key: str, path: Path) -> None: ...


class MemoryUploader:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, path: Path) -> None:
        self.objects[key] = path.read_bytes()


class S3Uploader:
    def __init__(self) -> None:
        import boto3
        from botocore.config import Config

        endpoint = os.environ.get("S3_ENDPOINT", "").strip()
        bucket = os.environ.get("S3_BUCKET", "").strip()
        access_key = os.environ.get("S3_ACCESS_KEY_ID", "").strip()
        secret_key = os.environ.get("S3_SECRET_ACCESS_KEY", "").strip()
        region = os.environ.get("S3_REGION", "").strip() or "us-east-1"
        if endpoint == "" or bucket == "" or access_key == "" or secret_key == "":
            raise IngestError("upload_failed")
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=Config(
                s3={"addressing_style": "path"},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    def put(self, key: str, path: Path) -> None:
        try:
            self.client.upload_file(
                str(path),
                self.bucket,
                key,
                ExtraArgs={"ContentType": "image/tiff"},
            )
        except IngestError:
            raise
        except Exception as error:
            raise IngestError("upload_failed") from error
