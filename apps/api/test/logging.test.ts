import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { createLogger, REDACTED } from "../src/logging.js";

describe("logging", () => {
  it("redacts an authorization header", () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger("test", stream);
    logger.info({ req: { headers: { authorization: "Bearer secret-token" } } }, "request");
    const text = lines.join("");
    expect(text).not.toContain("secret-token");
    expect(text).toContain(REDACTED);
  });
});
