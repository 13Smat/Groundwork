import { problemSchema } from "@groundwork/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../src/app.js";

describe("HTTP", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    app.post(
      "/echo",
      {
        schema: {
          body: z.object({
            name: z.string().min(1),
          }),
        },
      },
      async (request) => ({ name: request.body.name }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers /healthz", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("serves an OpenAPI document at /openapi.json", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    const body: unknown = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      openapi: expect.stringMatching(/^3\./),
      info: { title: "Groundwork API" },
    });
    const paths =
      typeof body === "object" && body !== null && "paths" in body ? body.paths : undefined;
    const health =
      typeof paths === "object" && paths !== null && "/healthz" in paths
        ? paths["/healthz"]
        : undefined;
    expect(health).toMatchObject({ get: expect.any(Object) });
  });

  it("returns problem+json for an unknown route", async () => {
    const response = await app.inject({ method: "GET", url: "/missing" });
    const body = problemSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(body).toMatchObject({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      instance: "/missing",
    });
  });

  it("returns problem+json when validation fails", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/echo",
      payload: {},
    });
    const body = problemSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(body.status).toBe(400);
    expect(body.title).toBe("Bad Request");
    expect(body.type).toBe("about:blank");
    expect(body.errors?.length).toBeGreaterThan(0);
    expect(body.errors?.[0]?.message).toEqual(expect.any(String));
  });
});
