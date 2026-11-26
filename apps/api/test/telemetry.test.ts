import { afterEach, describe, expect, it } from "vitest";

import { startTelemetry } from "../src/telemetry.js";

const keys = ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] as const;
const previous = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of keys) {
    const value = previous.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previous.clear();
});

describe("telemetry", () => {
  it("stays off when no OTLP endpoint is set", async () => {
    for (const key of keys) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }
    const telemetry = startTelemetry();
    expect(telemetry.enabled).toBe(false);
    await telemetry.shutdown();
  });
});
