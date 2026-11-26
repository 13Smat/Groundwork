import { describe, expect, it } from "vitest";

import { publicProposalInstance } from "./logging.js";

describe("public proposal problem instance", () => {
  it("uses one path for every public token", () => {
    const token = "abcdefghijklmnopqrstuvwxyz0123456789";
    expect(publicProposalInstance(`/public/proposals/${token}`)).toBe("/public/proposals/{token}");
    expect(publicProposalInstance(`/public/proposals/${token}/sign?x=1`)).toBe(
      "/public/proposals/{token}/sign",
    );
    expect(publicProposalInstance(`/public/proposals/${token}`)).not.toContain(token);
    expect(publicProposalInstance("/jobs/018f3c2e-7b10-7000-8000-000000000001?x=1")).toBe(
      "/jobs/018f3c2e-7b10-7000-8000-000000000001?x=1",
    );
  });
});
