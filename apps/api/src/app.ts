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

import { registerProblemHandlers } from "./errors.js";
import { registerImageryRoutes, type ImageryRouteOptions } from "./imagery/routes.js";
import { createLogger } from "./logging.js";

export async function buildApp(options?: {
  logger?: boolean | Logger;
  imagery?: ImageryRouteOptions;
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

  if (options?.imagery) {
    await registerImageryRoutes(app, options.imagery);
  }

  return app;
}
