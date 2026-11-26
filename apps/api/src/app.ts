import fastifySwagger from "@fastify/swagger";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { registerProblemHandlers } from "./errors.js";

export async function buildApp(options?: { logger?: boolean }) {
  const app = Fastify({
    logger: options?.logger ?? false,
  }).withTypeProvider<ZodTypeProvider>();

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

  return app;
}
