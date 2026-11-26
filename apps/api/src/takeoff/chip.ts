import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod/v4";

import { ProblemError } from "../errors.js";
import { assertCogKey } from "../imagery/policy.js";
import { getObject } from "../storage/s3.js";

const chipReport = z.object({
  ok: z.literal(true),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  crs_epsg: z.number().int(),
  transform: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  ground_pixel_m: z.number().finite().positive(),
  chip_base64: z.string().min(16),
});

const chipFailure = z.object({
  ok: z.literal(false),
  error: z.string(),
});

export type Chip = {
  width: number;
  height: number;
  crsEpsg: number;
  transform: [number, number, number, number, number, number];
  groundPixelM: number;
  chipBase64: string;
};

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function chipPython(): string {
  const override = process.env.IMAGERY_INGEST_PYTHON?.trim();
  if (override) {
    return override;
  }
  return path.join(repoRoot(), ".venv-imagery/bin/python");
}

function chipProblem(code: string | undefined): ProblemError {
  if (code === "chip_outside" || code === "chip_empty") {
    return new ProblemError({
      status: 409,
      title: "Conflict",
      detail: "The site is outside this capture.",
    });
  }
  return new ProblemError({
    status: 500,
    title: "Internal Server Error",
    detail: "The imagery chip could not be read.",
  });
}

function runCrop(
  python: string,
  file: string,
  bounds: { west: number; south: number; east: number; north: number },
  deadlineMs: number,
): Promise<unknown> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) {
    return Promise.reject(
      new ProblemError({
        status: 504,
        title: "Gateway Timeout",
        detail: "Assist did not finish within 10 seconds.",
      }),
    );
  }
  const args = [
    "-m",
    "groundwork_cv.crop",
    "--cog",
    file,
    "--west",
    String(bounds.west),
    "--south",
    String(bounds.south),
    "--east",
    String(bounds.east),
    "--north",
    String(bounds.north),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: repoRoot(),
      env: {
        ...process.env,
        PYTHONPATH: path.join(repoRoot(), "services/cv"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let received = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > 32 * 1024 * 1024) {
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
    }, remaining);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const text = Buffer.concat(stdout).toString("utf8").trim();
      if (text === "") {
        reject(chipProblem("cog_unreadable"));
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(chipProblem("cog_unreadable"));
      }
    });
  });
}

/**
 * Download the capture's COG from object storage and crop the site window.
 * The child reads a local file. It does not receive an imagery URL.
 */
export async function cropStoredCog(input: {
  cogKey: string;
  west: number;
  south: number;
  east: number;
  north: number;
  deadlineMs: number;
}): Promise<Chip> {
  const key = assertCogKey(input.cogKey);
  const bytes = await getObject(key);
  const directory = await mkdtemp(path.join(tmpdir(), "groundwork-chip-"));
  const file = path.join(directory, "capture.tif");
  try {
    await writeFile(file, bytes);
    const parsed: unknown = await runCrop(chipPython(), file, input, input.deadlineMs);
    const failed = chipFailure.safeParse(parsed);
    if (failed.success) {
      throw chipProblem(failed.data.error);
    }
    const report = chipReport.safeParse(parsed);
    if (!report.success) {
      throw chipProblem("cog_unreadable");
    }
    return {
      width: report.data.width,
      height: report.data.height,
      crsEpsg: report.data.crs_epsg,
      transform: report.data.transform,
      groundPixelM: report.data.ground_pixel_m,
      chipBase64: report.data.chip_base64,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
