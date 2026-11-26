import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Kysely } from "kysely";
import { z } from "zod/v4";

import type { ImageryAuthHook } from "../auth/hook.js";
import type { Database } from "../db/types.js";
import { ProblemError } from "../errors.js";
import {
  createImagerySource,
  createIngest,
  listImagerySources,
  patchImagerySource,
  readIngestJob,
  type IngestDispatch,
} from "./ingest-service.js";
import {
  createSourceBodySchema,
  imagerySourceResponseSchema,
  ingestBodySchema,
  ingestJobResponseSchema,
  patchSourceBodySchema,
} from "./ingest-schema.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

export type IngestRouteDeps = {
  db: Kysely<Database>;
  auth: ImageryAuthHook;
  dispatch?: IngestDispatch;
};

export async function registerImageryAdminRoutes(
  app: FastifyInstance,
  options: IngestRouteDeps,
): Promise<void> {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const auth = options.auth;

  routes.get(
    "/admin/imagery-sources",
    {
      schema: {
        tags: ["tenant-header"],
        response: { 200: z.object({ sources: z.array(imagerySourceResponseSchema) }) },
      },
    },
    async (request) => {
      const { workspaceId } = await auth(request);
      const sources = await listImagerySources(options.db, workspaceId);
      return { sources };
    },
  );

  routes.post(
    "/admin/imagery-sources",
    {
      schema: {
        tags: ["tenant-header"],
        body: createSourceBodySchema,
        response: { 201: imagerySourceResponseSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId } = await auth(request);
      const source = await createImagerySource(options.db, workspaceId, request.body);
      return reply.status(201).send(source);
    },
  );

  routes.patch(
    "/admin/imagery-sources/:sourceId",
    {
      schema: {
        tags: ["tenant-header"],
        params: z.object({ sourceId: z.uuidv7() }),
        body: patchSourceBodySchema,
        response: { 200: imagerySourceResponseSchema },
      },
    },
    async (request) => {
      const { workspaceId } = await auth(request);
      return patchImagerySource(options.db, workspaceId, request.params.sourceId, request.body);
    },
  );

  routes.post(
    "/imagery/ingest",
    {
      schema: {
        tags: ["tenant-header"],
        body: ingestBodySchema,
        response: { 200: ingestJobResponseSchema, 202: ingestJobResponseSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId } = await auth(request);
      const { job, created } = await createIngest(
        options.db,
        workspaceId,
        request.body,
        readIdempotencyKey(request.headers["idempotency-key"]),
        options.dispatch,
      );
      return reply.status(created ? 202 : 200).send(job);
    },
  );

  routes.get(
    "/imagery/ingest/:jobId",
    {
      schema: {
        tags: ["tenant-header"],
        params: z.object({ jobId: z.uuidv7() }),
        response: { 200: ingestJobResponseSchema },
      },
    },
    async (request) => {
      const { workspaceId } = await auth(request);
      return readIngestJob(options.db, workspaceId, request.params.jobId);
    },
  );
}

function readIdempotencyKey(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") {
    return undefined;
  }
  if (!IDEMPOTENCY_KEY.test(value)) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "Idempotency-Key must be 8 to 200 letters, digits, or . _ : -.",
    });
  }
  return value;
}
