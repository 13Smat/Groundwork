import { problem, PROBLEM_JSON_CONTENT_TYPE, type Problem } from "@groundwork/shared";
import type { FastifyInstance, FastifyReply } from "fastify";

import { publicProposalInstance } from "./logging.js";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  410: "Gone",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
};

function titleFor(status: number): string {
  return TITLES[status] ?? "Error";
}

const SQL_LEAK =
  /\b(select\s+[\s\S]{0,200}\s+from|insert\s+into|update\s+[a-z_][\w.]*\s+set|delete\s+from)\b/i;
const STACK_LEAK = /\n\s+at\s+/;

/**
 * Production responses keep a caller's own validation and conflict text.
 * A 500, a stack, or SQL is replaced so a database error cannot leave the process.
 */
function clientDetail(
  status: number,
  detail: string | undefined,
  safeDetail: boolean,
): string | undefined {
  if (detail === undefined) {
    return undefined;
  }
  const leak = SQL_LEAK.test(detail) || STACK_LEAK.test(detail);
  if (process.env.NODE_ENV === "production" && (leak || (status >= 500 && !safeDetail))) {
    return status >= 500 ? "An unexpected error occurred." : "The request could not be completed.";
  }
  return detail;
}

function forClient(body: Problem, safeDetail: boolean): Problem {
  const detail = clientDetail(body.status, body.detail, safeDetail);
  const errors = body.errors?.map((error) => {
    const message = clientDetail(body.status, error.message, true);
    return message === undefined ? error : { ...error, message };
  });
  return {
    ...body,
    ...(detail !== undefined ? { detail } : {}),
    ...(errors ? { errors } : {}),
  };
}

function sendProblem(reply: FastifyReply, body: Problem, safeDetail: boolean) {
  return reply
    .status(body.status)
    .type(PROBLEM_JSON_CONTENT_TYPE)
    .send(forClient(body, safeDetail));
}

/**
 * A problem the caller wants returned as-is. `detail` is visible to the client,
 * so it must not contain secrets or SQL.
 */
export class ProblemError extends Error {
  readonly statusCode: number;
  readonly problemBody: Problem;

  constructor(input: {
    status: number;
    title: string;
    detail?: string | undefined;
    instance?: string | undefined;
    type?: string | undefined;
    errors?: readonly { message: string; path?: string | undefined }[] | undefined;
  }) {
    const body = problem(input);
    super(body.detail ?? body.title);
    this.name = "ProblemError";
    this.statusCode = body.status;
    this.problemBody = body;
  }
}

function isProblemError(error: unknown): error is ProblemError {
  return error instanceof ProblemError;
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return undefined;
  }
  const statusCode = error.statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

export function registerProblemHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    sendProblem(
      reply,
      problem({
        status: 404,
        title: titleFor(404),
        detail: `No route for ${request.method} ${publicProposalInstance(request.url)}.`,
        instance: publicProposalInstance(request.url),
      }),
      true,
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const instance = publicProposalInstance(request.url);

    if (isProblemError(error)) {
      sendProblem(
        reply,
        {
          ...error.problemBody,
          instance: error.problemBody.instance ?? instance,
        },
        true,
      );
      return;
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const errors = error.validation.map((issue) => {
        const path =
          "instancePath" in issue && typeof issue.instancePath === "string"
            ? issue.instancePath
            : undefined;
        return {
          message: issue.message ?? "Invalid value",
          ...(path ? { path } : {}),
        };
      });
      sendProblem(
        reply,
        problem({
          status: 400,
          title: titleFor(400),
          detail: "The request failed validation.",
          instance,
          errors,
        }),
        true,
      );
      return;
    }

    if (isResponseSerializationError(error)) {
      request.log.error(error);
      sendProblem(
        reply,
        problem({
          status: 500,
          title: titleFor(500),
          detail: "The response did not match the schema.",
          instance,
        }),
        true,
      );
      return;
    }

    const reported = statusCodeOf(error);
    const status = reported !== undefined && reported >= 400 && reported <= 599 ? reported : 500;
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    if (status >= 500) {
      request.log.error(error);
    }
    const detail =
      status >= 500 && process.env.NODE_ENV === "production"
        ? "An unexpected error occurred."
        : message;

    sendProblem(
      reply,
      problem({
        status,
        title: titleFor(status),
        detail,
        instance,
      }),
      false,
    );
  });
}
