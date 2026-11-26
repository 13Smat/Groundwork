import { problemSchema } from "@groundwork/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { buildApp } from "../src/app.js";
import { ProblemError } from "../src/errors.js";

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
    app.get("/conflict", async () => {
      throw new ProblemError({
        status: 409,
        title: "Conflict",
        detail: "The transition is not allowed.",
      });
    });
    app.get("/sql", async () => {
      throw new ProblemError({
        status: 500,
        title: "Internal Server Error",
        detail: "insert into secret (token) values ('sk_live')",
      });
    });
    app.get("/stack", async () => {
      throw new ProblemError({
        status: 500,
        title: "Internal Server Error",
        detail: "boom\n    at leak (handler.ts:1:1)",
      });
    });
    app.get("/cents", async () => {
      throw new ProblemError({
        status: 500,
        title: "Internal Server Error",
        detail: "Stored cents were not an integer.",
      });
    });
    app.get("/leaked-conflict", async () => {
      throw new ProblemError({
        status: 409,
        title: "Conflict",
        detail: "select token from secret where id = '1'",
      });
    });
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

  it("returns the problem thrown by a route", async () => {
    const response = await app.inject({ method: "GET", url: "/conflict" });
    const body = problemSchema.parse(response.json());

    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(body).toMatchObject({
      title: "Conflict",
      status: 409,
      detail: "The transition is not allowed.",
      instance: "/conflict",
    });
  });

  it("hides SQL and stack traces when NODE_ENV is production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const sql = await app.inject({ method: "GET", url: "/sql" });
      expect(sql.statusCode).toBe(500);
      expect(sql.json()).toMatchObject({
        status: 500,
        detail: "An unexpected error occurred.",
      });
      expect(sql.body).not.toContain("secret");

      const stack = await app.inject({ method: "GET", url: "/stack" });
      expect(stack.json()).toMatchObject({ detail: "An unexpected error occurred." });
      expect(stack.body).not.toContain("handler.ts");

      const cents = await app.inject({ method: "GET", url: "/cents" });
      expect(cents.json()).toMatchObject({ detail: "Stored cents were not an integer." });

      const leaked = await app.inject({ method: "GET", url: "/leaked-conflict" });
      expect(leaked.statusCode).toBe(409);
      expect(leaked.json()).toMatchObject({ detail: "The request could not be completed." });
      expect(leaked.body).not.toContain("select");
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
      }
    }
  });
});
