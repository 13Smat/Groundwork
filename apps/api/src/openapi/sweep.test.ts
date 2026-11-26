import { describe, expect, it } from "vitest";

import { buildUrl, planTenantSweep, type Fixture } from "./sweep.js";

const fixtures: Record<string, Fixture> = {
  "get /jobs/{id}": { kind: "foreign", params: { id: "{{job}}" } },
  "get /clients": { kind: "caller-scoped", reason: "Lists the caller's workspace." },
};

describe("tenant sweep plan", () => {
  it("requires a fixture for every tenant route and skips public and webhook by tag", () => {
    const plan = planTenantSweep(
      {
        paths: {
          "/jobs/{id}": { get: { tags: ["tenant-header"] } },
          "/clients": { get: { tags: ["tenant-header"] } },
          "/public/proposals/{token}": { get: { tags: ["public"] } },
          "/webhooks/esign/{provider}": { post: { tags: ["webhook"] } },
          "/secret/{id}": { get: { tags: ["tenant-header"] } },
          "/healthz": { get: { tags: ["meta"] } },
          "/me": { get: { tags: ["session"] } },
          "/untagged": { get: {} },
        },
      },
      fixtures,
    );

    expect(plan.calls.map((call) => call.key)).toEqual(["get /jobs/{id}"]);
    expect(plan.callerScoped).toEqual(["get /clients"]);
    expect(plan.excluded.sort()).toEqual([
      "get /public/proposals/{token}",
      "post /webhooks/esign/{provider}",
    ]);
    expect(plan.problems).toEqual([
      "get /secret/{id} is a tenant route with no fixture mapping.",
      "get /untagged has no tenant, public, webhook, session, or meta tag.",
    ]);
  });

  it("does not skip a public-looking path that lacks the public tag", () => {
    const plan = planTenantSweep(
      {
        paths: {
          "/public/proposals/{token}": { get: { tags: ["tenant-header"] } },
        },
      },
      {},
    );
    expect(plan.excluded).toEqual([]);
    expect(plan.problems).toEqual([
      "get /public/proposals/{token} is a tenant route with no fixture mapping.",
    ]);
  });

  it("fills workspace B ids into the request url", () => {
    const call = planTenantSweep(
      { paths: { "/jobs/{id}/notes": { post: { tags: ["tenant-header"] } } } },
      {
        "post /jobs/{id}/notes": {
          kind: "foreign",
          params: { id: "{{job}}" },
          body: { body: "note" },
        },
      },
    ).calls[0];
    if (!call) {
      throw new Error("missing planned call");
    }
    expect(buildUrl(call.path, call.fixture, { job: "018f3c2e-7b10-7000-8000-000000000099" })).toBe(
      "/jobs/018f3c2e-7b10-7000-8000-000000000099/notes",
    );
  });
});
