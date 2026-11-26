import { z } from "zod/v4";

import { readCvServiceUrl } from "../config.js";
import { ProblemError } from "../errors.js";

/** Two retries after the first attempt. Spec 05: retry infra, not a model error. */
export const CV_INFRA_RETRIES = 2;

const promptOut = z.object({
  polygons_px: z.array(z.array(z.tuple([z.number(), z.number()])).min(4)).max(64),
  gpu_seconds: z.number().finite().nonnegative(),
});

export type CvPoint = { x: number; y: number; label: 0 | 1 };

export type CvPrompt = {
  chip: string;
  transform: number[];
  points: CvPoint[];
  box: [number, number, number, number] | null;
};

export type CvPromptResult = z.infer<typeof promptOut>;

export function buildCvPrompt(input: CvPrompt): CvPrompt {
  return {
    chip: input.chip,
    transform: input.transform,
    points: input.points.map((point) => ({ x: point.x, y: point.y, label: point.label })),
    box: input.box,
  };
}

export function cvPromptKeys(body: CvPrompt): string[] {
  return Object.keys(body);
}

function segmentUrl(): string {
  return new URL("/segment/prompt", readCvServiceUrl()).toString();
}

function timeoutProblem(): ProblemError {
  return new ProblemError({
    status: 504,
    title: "Gateway Timeout",
    detail: "Assist did not finish within 10 seconds.",
  });
}

function modelProblem(): ProblemError {
  return new ProblemError({
    status: 502,
    title: "Bad Gateway",
    detail: "The segmentation service rejected the chip.",
  });
}

function infraProblem(): ProblemError {
  return new ProblemError({
    status: 502,
    title: "Bad Gateway",
    detail: "The segmentation service is unavailable.",
  });
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/**
 * POST /segment/prompt. A 4xx is a model error and is not retried. A network
 * failure or a 5xx is retried twice, inside the caller's deadline.
 */
export async function segmentPrompt(body: CvPrompt, deadlineMs: number): Promise<CvPromptResult> {
  const payload = JSON.stringify(buildCvPrompt(body));
  let sawTimeout = false;
  for (let attempt = 0; attempt <= CV_INFRA_RETRIES; attempt += 1) {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      throw timeoutProblem();
    }
    try {
      const response = await fetch(segmentUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(remaining),
      });
      if (response.status >= 400 && response.status < 500) {
        throw modelProblem();
      }
      if (!response.ok) {
        continue;
      }
      const parsed = promptOut.safeParse(await response.json());
      if (!parsed.success) {
        throw modelProblem();
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof ProblemError) {
        throw error;
      }
      if (isTimeout(error)) {
        sawTimeout = true;
      }
    }
  }
  if (sawTimeout || Date.now() >= deadlineMs) {
    throw timeoutProblem();
  }
  throw infraProblem();
}
