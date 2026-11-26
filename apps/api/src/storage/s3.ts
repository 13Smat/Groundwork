import { HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isUuidV7 } from "@groundwork/shared";

import { readObjectStorageConfig, type ObjectStorageConfig } from "../config.js";
import { ProblemError } from "../errors.js";

/** Provisional. The specs do not set a presign lifetime. See OPEN-QUESTIONS. */
export const DEFAULT_UPLOAD_EXPIRES_SECONDS = 900;
const MAX_UPLOAD_EXPIRES_SECONDS = 3600;

export type PresignedUpload = {
  url: string;
  method: "PUT";
  headers: { "content-type": string };
  storageKey: string;
  expiresInSeconds: number;
};

export function workspaceStorageKey(workspaceId: string, fileId: string): string {
  if (!isUuidV7(workspaceId) || !isUuidV7(fileId)) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "Workspace id and file id must be UUIDv7.",
    });
  }
  return `workspaces/${workspaceId}/${fileId}`;
}

function assertStorageKey(storageKey: string): void {
  if (
    storageKey.trim() === "" ||
    storageKey.startsWith("/") ||
    storageKey.includes("..") ||
    storageKey.includes("\\")
  ) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "Storage key must be a relative path without '..'.",
    });
  }
}

function assertExpires(expiresInSeconds: number): void {
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > MAX_UPLOAD_EXPIRES_SECONDS
  ) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: `Upload URL lifetime must be a whole number of seconds from 1 to ${MAX_UPLOAD_EXPIRES_SECONDS}.`,
    });
  }
}

export function createS3Client(config: ObjectStorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // The current SDK adds checksum headers MinIO rejects unless this is set.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export async function presignUpload(
  input: { storageKey: string; mime: string; expiresInSeconds?: number },
  config: ObjectStorageConfig = readObjectStorageConfig(),
): Promise<PresignedUpload> {
  assertStorageKey(input.storageKey);
  if (input.mime.trim() === "") {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "Upload mime type is required.",
    });
  }
  const expiresInSeconds = input.expiresInSeconds ?? DEFAULT_UPLOAD_EXPIRES_SECONDS;
  assertExpires(expiresInSeconds);

  const client = createS3Client(config);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: input.storageKey,
    ContentType: input.mime,
  });
  const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  return {
    url,
    method: "PUT",
    headers: { "content-type": input.mime },
    storageKey: input.storageKey,
    expiresInSeconds,
  };
}

/** Confirm the bucket exists. Compose's minio-init creates it. */
export async function checkObjectStorage(config: ObjectStorageConfig): Promise<void> {
  const client = createS3Client(config);
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < 15_000) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const message = lastError instanceof Error ? lastError.message : "unknown error";
  throw new Error(
    `Object storage bucket "${config.bucket}" at ${config.endpoint} is not reachable. ${message}`,
  );
}
