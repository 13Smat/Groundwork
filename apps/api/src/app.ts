import fastifySwagger from "@fastify/swagger";
import Fastify, { type FastifyBaseLogger } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Logger } from "pino";
import type pg from "pg";
import { z } from "zod/v4";

import { createAuth } from "./auth/auth.js";
import { createSessionImageryAuth } from "./auth/hook.js";
import { registerAuthHandler } from "./auth/http.js";
import { createMailer, type Mailer } from "./auth/mail.js";
import { createDb } from "./db/client.js";
import { registerProblemHandlers } from "./errors.js";
import { registerImageryRoutes, type ImageryRouteOptions } from "./imagery/routes.js";
import { createLogger } from "./logging.js";
import { registerCatalogRoutes } from "./catalog/routes.js";
import { registerGroundworkRoutes } from "./routes/groundwork.js";

export async function buildApp(options?: {
  logger?: boolean | Logger;
  database?: { app: pg.Pool; auth: pg.Pool };
  mailer?: Mailer;
  imagery?: Omit<ImageryRouteOptions, "db" | "auth"> & { db?: ImageryRouteOptions["db"] };
}) {
  const logger =
    options?.logger === true ? createLogger("api") : options?.logger ? options.logger : undefined;
  const app = Fastify(
    logger ? { loggerInstance: logger as FastifyBaseLogger } : { logger: false },
  ).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerProblemHandlers(app);

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Groundwork API",
        version: "0.0.0",
      },
    },
    transform: jsonSchemaTransform,
  });

  app.get(
    "/healthz",
    {
      schema: {
        response: {
          200: z.object({
            status: z.literal("ok"),
          }),
        },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get("/openapi.json", async () => app.swagger());

  if (options?.database) {
    const db = options.imagery?.db ?? createDb(options.database.app);
    const mailer = options.mailer ?? createMailer(app.log);
    const auth = createAuth(options.database.auth, mailer);
    registerAuthHandler(app, auth);
    await registerGroundworkRoutes(app, {
      db,
      authPool: options.database.auth,
      auth,
      mailer,
    });
    await registerCatalogRoutes(app, {
      db,
      authPool: options.database.auth,
      auth,
    });
    await registerImageryRoutes(app, {
      ...options.imagery,
      db,
      auth: createSessionImageryAuth({
        db,
        auth,
        authPool: options.database.auth,
      }),
    });
  }

  return app;
}
