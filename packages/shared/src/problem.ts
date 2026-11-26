import { z } from "zod/v4";

/** RFC 9457 media type. */
export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json" as const;

const problemErrorSchema = z.object({
  message: z.string().min(1),
  path: z.string().optional(),
});

/**
 * RFC 9457 problem details. Unknown keys are kept so extension members survive a parse.
 * `errors` is our extension for field-level validation issues.
 */
export const problemSchema = z.looseObject({
  type: z.string().min(1).default("about:blank"),
  title: z.string().min(1),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(problemErrorSchema).optional(),
});

export type Problem = z.infer<typeof problemSchema>;

export function problem(input: {
  status: number;
  title: string;
  detail?: string | undefined;
  instance?: string | undefined;
  type?: string | undefined;
  errors?: readonly { message: string; path?: string | undefined }[] | undefined;
}): Problem {
  return problemSchema.parse(input);
}
