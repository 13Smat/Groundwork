import fastifySwagger from "@fastify/swagger";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Logger } from "pino";
import { z } from "zod/v4";

import type pg from "pg";

import { createAuth } from "./auth/auth.js";
import { registerAuthHandler } from "./auth/http.js";
import { createMailer, type Mailer } from "./auth/mail.js";
import { createDb } from "./db/client.js";
import { registerProblemHandlers } from "./errors.js";
import { createLogger } from "./logging.js";
import { registerGroundworkRoutes } from "./routes/groundwork.js";

export async function buildApp(options?: {
  logger?: boolean | Logger;
  database?: { app: pg.Pool; auth: pg.Pool };
  mailer?: Mailer;
}) {
  const logger =
    options?.logger === true ? createLogger("api") : options?.logger ? options.logger : false;
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();

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
    const mailer = options.mailer ?? createMailer(app.log);
    const auth = createAuth(options.database.auth, mailer);
    registerAuthHandler(app, auth);
    await registerGroundworkRoutes(app, {
      db: createDb(options.database.app),
      authPool: options.database.auth,
      auth,
      mailer,
    });
  }

  return app;
}
