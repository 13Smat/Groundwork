import { describe, expect, it } from "vitest";

import { buildCvPrompt, cvPromptKeys } from "./cv-client.js";

describe("CV prompt body", () => {
  it("sends only the chip, the transform, points, and an optional box", () => {
    const body = buildCvPrompt({
      chip: "aaaa",
      transform: [1, 0, 0, 0, 1, 0],
      points: [{ x: 1, y: 2, label: 1 }],
      box: null,
    });
    expect(cvPromptKeys(body).sort()).toEqual(["box", "chip", "points", "transform"]);
    expect(JSON.stringify(body)).not.toContain("parcel");
  });
});
