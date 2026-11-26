import { describe, expect, it } from "vitest";

import { PROBLEM_JSON_CONTENT_TYPE, problem, problemSchema } from "./problem.js";

describe("problem+json", () => {
  it("defaults type to about:blank and keeps extension members", () => {
    const parsed = problemSchema.parse({
      title: "Not Found",
      status: 404,
      traceId: "abc",
    });

    expect(parsed.type).toBe("about:blank");
    expect(parsed.status).toBe(404);
    expect(parsed.traceId).toBe("abc");
    expect(PROBLEM_JSON_CONTENT_TYPE).toBe("application/problem+json");
  });

  it("builds a problem document", () => {
    expect(
      problem({
        status: 400,
        title: "Bad Request",
        detail: "The request failed validation.",
        instance: "/echo",
        errors: [{ message: "Required", path: "/name" }],
      }),
    ).toMatchObject({
      type: "about:blank",
      status: 400,
      title: "Bad Request",
      errors: [{ message: "Required", path: "/name" }],
    });
  });

  it("rejects a problem with no title", () => {
    expect(() => problemSchema.parse({ status: 400 })).toThrow();
  });
});
