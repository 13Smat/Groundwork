import { createId } from "@groundwork/shared";
import { describe, expect, it } from "vitest";

import { LOCAL_S3_ACCESS_KEY_ID, LOCAL_S3_SECRET_ACCESS_KEY } from "../src/config.js";
import { ProblemError } from "../src/errors.js";
import {
  DEFAULT_UPLOAD_EXPIRES_SECONDS,
  presignUpload,
  workspaceStorageKey,
} from "../src/storage/s3.js";

const storage = {
  endpoint: "http://127.0.0.1:9000",
  region: "us-east-1",
  bucket: "groundwork",
  accessKeyId: LOCAL_S3_ACCESS_KEY_ID,
  secretAccessKey: LOCAL_S3_SECRET_ACCESS_KEY,
};

describe("presigned upload", () => {
  it("builds a workspace-prefixed key and a PUT URL", async () => {
    const workspaceId = createId();
    const fileId = createId();
    const storageKey = workspaceStorageKey(workspaceId, fileId);
    expect(storageKey).toBe(`workspaces/${workspaceId}/${fileId}`);

    const signed = await presignUpload({ storageKey, mime: "image/jpeg" }, storage);
    expect(signed.method).toBe("PUT");
    expect(signed.headers["content-type"]).toBe("image/jpeg");
    expect(signed.expiresInSeconds).toBe(DEFAULT_UPLOAD_EXPIRES_SECONDS);
    expect(signed.url).toContain("groundwork");
    expect(signed.url).toContain("X-Amz-Algorithm");
    expect(signed.url).toContain(`X-Amz-Expires=${DEFAULT_UPLOAD_EXPIRES_SECONDS}`);
    expect(decodeURIComponent(signed.url)).toContain(storageKey);
  });

  it("rejects a key that leaves the bucket prefix", async () => {
    await expect(
      presignUpload({ storageKey: "../secret", mime: "text/plain" }, storage),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it("rejects ids that are not UUIDv7", () => {
    expect(() => workspaceStorageKey("not-a-uuid", createId())).toThrow(ProblemError);
  });
});
