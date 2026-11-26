import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { NodeSDK } from "@opentelemetry/sdk-node";

export type Telemetry = {
  enabled: boolean;
  shutdown: () => Promise<void>;
};

/**
 * Start tracing only when an OTLP endpoint is configured. Local dev and CI
 * leave it unset and do not need a collector or a vendor account.
 */
export function startTelemetry(): Telemetry {
  const traces = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ?? "";
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? "";
  const endpoint = traces || base;
  if (endpoint === "") {
    return { enabled: false, shutdown: async () => {} };
  }

  const url = endpoint.endsWith("/v1/traces")
    ? endpoint
    : `${endpoint.replace(/\/$/, "")}/v1/traces`;
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "groundwork-api";
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({ url }),
    instrumentations: [new HttpInstrumentation(), new PgInstrumentation()],
  });
  sdk.start();
  return { enabled: true, shutdown: () => sdk.shutdown() };
}
