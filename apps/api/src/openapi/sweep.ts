/**
 * Plans the cross-tenant 404 sweep from an OpenAPI document.
 * Public and webhook operations are skipped because of their tags.
 * A tenant operation with no fixture entry is a failure, so a new route
 * cannot pass by being omitted. ADR 0023.
 */

export const EXCLUDED_TAGS = ["public", "webhook"] as const;
export const OTHER_TAGS = ["session", "meta"] as const;
const NON_RESOURCE_PARAMS = new Set(["z", "x", "y"]);

export type Fixture =
  | {
      kind: "foreign";
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: unknown;
    }
  | { kind: "caller-scoped"; reason: string };

type Operation = {
  tags?: string[];
  parameters?: { name: string; in: string }[];
};

type Spec = {
  paths?: Record<string, Record<string, Operation | undefined>>;
};

export type PlannedCall = {
  key: string;
  method: string;
  path: string;
  fixture: Extract<Fixture, { kind: "foreign" }>;
};

export type SweepPlan = {
  calls: PlannedCall[];
  callerScoped: string[];
  excluded: string[];
  problems: string[];
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function planTenantSweep(spec: Spec, fixtures: Record<string, Fixture>): SweepPlan {
  const calls: PlannedCall[] = [];
  const callerScoped: string[] = [];
  const excluded: string[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) {
        continue;
      }
      const key = `${method} ${path}`;
      seen.add(key);
      const tags = operation.tags ?? [];
      const tenant = tags.some((tag) => tag.startsWith("tenant-"));
      const excludedTag = tags.some((tag) => (EXCLUDED_TAGS as readonly string[]).includes(tag));
      const other = tags.some((tag) => (OTHER_TAGS as readonly string[]).includes(tag));
      if (tenant && excludedTag) {
        problems.push(`${key} is tagged both tenant and public or webhook.`);
        continue;
      }
      if (excludedTag) {
        excluded.push(key);
        continue;
      }
      if (!tenant && other) {
        continue;
      }
      if (!tenant) {
        problems.push(`${key} has no tenant, public, webhook, session, or meta tag.`);
        continue;
      }
      const fixture = fixtures[key];
      if (!fixture) {
        problems.push(`${key} is a tenant route with no fixture mapping.`);
        continue;
      }
      const pathParams = pathParamNames(path, operation);
      if (fixture.kind === "caller-scoped") {
        const resourceParams = pathParams.filter((name) => !NON_RESOURCE_PARAMS.has(name));
        if (resourceParams.length > 0) {
          problems.push(
            `${key} is marked caller-scoped but has path params ${resourceParams.join(", ")}.`,
          );
          continue;
        }
        callerScoped.push(key);
        continue;
      }
      for (const name of pathParams) {
        if (fixture.params?.[name] === undefined) {
          problems.push(`${key} fixture does not set path param ${name}.`);
        }
      }
      calls.push({ key, method, path, fixture });
    }
  }

  for (const key of Object.keys(fixtures)) {
    if (!seen.has(key)) {
      problems.push(`${key} is in the fixture map but not in the OpenAPI document.`);
    }
  }

  return { calls, callerScoped, excluded, problems };
}

function pathParamNames(path: string, operation: Operation): string[] {
  const fromPath = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
  const fromOperation = (operation.parameters ?? [])
    .filter((parameter) => parameter.in === "path")
    .map((parameter) => parameter.name);
  return [...new Set([...fromPath, ...fromOperation])];
}

const TOKEN = /\{\{([A-Za-z0-9_]+)\}\}/g;

export function fillTokens(value: unknown, ids: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(TOKEN, (whole, key: string) => {
      const id = ids[key];
      if (!id) {
        throw new Error(`No fixture id for {{${key}}}.`);
      }
      return id;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => fillTokens(item, ids));
  }
  if (value && typeof value === "object") {
    const filled: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      filled[key] = fillTokens(item, ids);
    }
    return filled;
  }
  return value;
}

export function buildUrl(
  path: string,
  fixture: Extract<Fixture, { kind: "foreign" }>,
  ids: Record<string, string>,
): string {
  const params = fixture.params ?? {};
  let url = path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const raw = params[name];
    if (raw === undefined) {
      throw new Error(`${path} is missing param ${name}.`);
    }
    return encodeURIComponent(String(fillTokens(raw, ids)));
  });
  if (fixture.query) {
    const search = new URLSearchParams();
    for (const [name, raw] of Object.entries(fixture.query)) {
      search.set(name, String(fillTokens(raw, ids)));
    }
    url += `?${search.toString()}`;
  }
  return url;
}
