import { describe, expect, it } from "vitest";

import {
  ImageryCaptureTransitionError,
  assertImageryCaptureTransition,
} from "./imagery-capture.js";

describe("imagery capture state machine", () => {
  it("allows ingesting to become ready or failed", () => {
    expect(() => assertImageryCaptureTransition("ingesting", "ready")).not.toThrow();
    expect(() => assertImageryCaptureTransition("ingesting", "failed")).not.toThrow();
  });

  it("rejects every other transition", () => {
    const illegal: Array<["ingesting" | "ready" | "failed", "ingesting" | "ready" | "failed"]> = [
      ["ingesting", "ingesting"],
      ["ready", "failed"],
      ["ready", "ingesting"],
      ["ready", "ready"],
      ["failed", "ready"],
      ["failed", "ingesting"],
      ["failed", "failed"],
    ];
    for (const [from, to] of illegal) {
      expect(() => assertImageryCaptureTransition(from, to)).toThrow(ImageryCaptureTransitionError);
    }
  });
});
