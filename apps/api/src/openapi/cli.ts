import { readFileSync } from "node:fs";

import {
  breaksAgainst,
  canonicalize,
  formatBreaks,
  generateOpenApi,
  openApiPath,
  readOpenApi,
  writeOpenApi,
} from "./document.js";

const command = process.argv[2];

if (command === "write") {
  const document = await generateOpenApi();
  writeOpenApi(document);
  console.log(`Wrote ${openApiPath()}`);
} else if (command === "check") {
  const document = await generateOpenApi();
  const fresh = canonicalize(document);
  const committed = readFileSync(openApiPath(), "utf8");
  if (fresh !== committed) {
    console.error("apps/api/openapi.json is stale. Run pnpm openapi:write and commit it.");
    process.exit(1);
  }
  const baseFile = process.env.OPENAPI_BASE;
  if (baseFile) {
    assertCompatible(baseFile, openApiPath());
  }
  console.log("openapi.json matches the running API.");
} else if (command === "breaking") {
  const baseFile = process.env.OPENAPI_BASE;
  if (!baseFile) {
    console.error("OPENAPI_BASE must be the previous openapi.json.");
    process.exit(1);
  }
  assertCompatible(baseFile, openApiPath());
  console.log("openapi.json has no blocking breaking changes.");
} else {
  console.error("Usage: tsx src/openapi/cli.ts write|check|breaking");
  process.exit(1);
}

function assertCompatible(baseFile: string, headFile: string): void {
  const breaks = breaksAgainst(JSON.parse(readFileSync(baseFile, "utf8")), readOpenApi(headFile));
  if (breaks.length > 0) {
    console.error("Breaking OpenAPI changes need an info.version bump.\n" + formatBreaks(breaks));
    process.exit(1);
  }
}
