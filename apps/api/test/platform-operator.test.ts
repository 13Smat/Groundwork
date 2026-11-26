import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");

describe("platform operator", () => {
  it("is not referenced by an HTTP route module", () => {
    const hits = routeModules(SRC).filter((file) =>
      readFileSync(file, "utf8").includes("platform_operator"),
    );
    expect(hits).toEqual([]);
  });
});

function routeModules(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...routeModules(full));
      continue;
    }
    if (entry.includes("route") && entry.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}
