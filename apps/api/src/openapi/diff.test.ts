import { describe, expect, it } from "vitest";

import { blockingBreaks, diffOpenApi, type BreakingChange } from "./diff.js";

const previous = {
  openapi: "3.1.0",
  info: { title: "Groundwork API", version: "0.0.0" },
  paths: {
    "/widgets": {
      get: {
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { id: { type: "string" } },
                  required: ["id"],
                },
              },
            },
          },
        },
      },
    },
    "/gadgets": {
      get: { responses: { 200: { description: "ok" } } },
      post: { responses: { 201: { description: "created" } } },
    },
    "/items": {
      get: {
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", maximum: 100 },
          },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sku: { type: "string" },
                    qty: { type: "number" },
                    name: { type: "string" },
                    kind: { type: "string", enum: ["a", "b"] },
                  },
                  required: ["sku", "qty"],
                },
              },
            },
          },
        },
      },
    },
  },
};

const breaking = {
  openapi: "3.1.0",
  info: { title: "Groundwork API", version: "0.0.0" },
  paths: {
    "/gadgets": {
      get: { responses: { 200: { description: "ok" } } },
    },
    "/items": {
      get: {
        parameters: [
          { name: "limit", in: "query", required: true, schema: { type: "integer", maximum: 10 } },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    qty: { type: "integer" },
                    name: { type: "string" },
                    kind: { type: "string", enum: ["a"] },
                  },
                  required: ["qty", "name"],
                },
              },
            },
          },
        },
      },
    },
  },
};

const compatible = {
  openapi: "3.1.0",
  info: { title: "Groundwork API", version: "0.0.0" },
  paths: {
    ...previous.paths,
    "/widgets": {
      get: previous.paths["/widgets"].get,
      post: { responses: { 201: { description: "created" } } },
    },
    "/items/{id}": {
      get: { responses: { 200: { description: "one item" } } },
    },
    "/items": {
      get: {
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", maximum: 100 },
          },
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "tag", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sku: { type: "string" },
                    qty: { type: "number" },
                    name: { type: "string" },
                    kind: { type: "string", enum: ["a", "b", "c"] },
                    note: { type: "string" },
                  },
                  required: ["sku", "qty"],
                },
              },
            },
          },
        },
      },
    },
  },
};

function rules(changes: BreakingChange[]): string[] {
  return changes.map((change) => `${change.rule} ${change.location}`).sort();
}

describe("OpenAPI breaking-change diff", () => {
  it("accepts a non-breaking fixture", () => {
    expect(diffOpenApi(previous, compatible)).toEqual([]);
    expect(blockingBreaks(previous, compatible)).toEqual([]);
  });

  it("flags a breaking fixture when the API version stays put", () => {
    const changes = diffOpenApi(previous, breaking);
    expect(rules(changes)).toEqual(
      [
        "narrowed-type GET /items parameter query.limit",
        "narrowed-type GET /items response 200 application/json kind",
        "narrowed-type GET /items response 200 application/json qty",
        "newly-required GET /items parameter query.limit",
        "newly-required GET /items response 200 application/json name",
        "removed-field GET /items parameter query.q",
        "removed-field GET /items response 200 application/json sku",
        "removed-operation POST /gadgets",
        "removed-path /widgets",
      ].sort(),
    );
    expect(blockingBreaks(previous, breaking)).toEqual(changes);
  });

  it("allows the same breaking fixture when info.version changes", () => {
    const bumped = {
      ...breaking,
      info: { title: "Groundwork API", version: "0.1.0" },
    };
    expect(diffOpenApi(previous, bumped).length).toBeGreaterThan(0);
    expect(blockingBreaks(previous, bumped)).toEqual([]);
  });
});
