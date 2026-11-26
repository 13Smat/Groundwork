import { problem, PROBLEM_JSON_CONTENT_TYPE, type Problem } from "@groundwork/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
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
  500: "Internal Server Error",
};

function titleFor(status: number): string {
  return TITLES[status] ?? "Error";
}

function sendProblem(reply: FastifyReply, body: Problem) {
  return reply.status(body.status).type(PROBLEM_JSON_CONTENT_TYPE).send(body);
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
        detail: `No route for ${request.method} ${request.url}.`,
        instance: request.url,
      }),
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const instance = request.url;

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
    );
  });
}
