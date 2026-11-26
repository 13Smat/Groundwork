/**
 * Breaking-change diff for the committed OpenAPI document.
 * A change is breaking when it removes a path or operation, removes a field,
 * makes a field required, or narrows a type. Adding optional surface is not.
 * ADR 0023.
 */

export type BreakingRule =
  "removed-path" | "removed-operation" | "removed-field" | "newly-required" | "narrowed-type";

export type BreakingChange = {
  location: string;
  rule: BreakingRule;
  detail: string;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type Schema = {
  $ref?: string;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  type?: string | string[];
  enum?: Json[];
  const?: Json;
  format?: string;
  nullable?: boolean;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean | Schema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
};

type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
};

type Operation = {
  parameters?: Parameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Schema }>;
  };
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
};

type Document = {
  info?: { version?: string };
  paths?: Record<string, Record<string, unknown> & { parameters?: Parameter[] }>;
  components?: { schemas?: Record<string, Schema> };
};

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;
const JSON_TYPES = ["application/json", "application/problem+json"] as const;

export function infoVersion(document: unknown): string {
  const info = asDocument(document).info;
  return typeof info?.version === "string" ? info.version : "";
}

/** Breaking changes. An `info.version` bump does not hide them; the caller decides. */
export function diffOpenApi(previous: unknown, next: unknown): BreakingChange[] {
  const before = asDocument(previous);
  const after = asDocument(next);
  const breaks: BreakingChange[] = [];
  const previousPaths = before.paths ?? {};
  const nextPaths = after.paths ?? {};

  for (const path of Object.keys(previousPaths).sort()) {
    const previousPath = previousPaths[path];
    const nextPath = nextPaths[path];
    if (!previousPath || !nextPath) {
      if (!nextPath) {
        breaks.push({
          location: path,
          rule: "removed-path",
          detail: `${path} was removed.`,
        });
      }
      continue;
    }
    for (const method of METHODS) {
      const previousOp = previousPath[method];
      const nextOp = nextPath[method];
      if (!isOperation(previousOp)) {
        continue;
      }
      const location = `${method.toUpperCase()} ${path}`;
      if (!isOperation(nextOp)) {
        breaks.push({
          location,
          rule: "removed-operation",
          detail: `${location} was removed.`,
        });
        continue;
      }
      compareOperation(location, previousPath, previousOp, nextPath, nextOp, before, after, breaks);
    }
  }

  return breaks;
}

export function blockingBreaks(previous: unknown, next: unknown): BreakingChange[] {
  if (infoVersion(previous) !== infoVersion(next)) {
    return [];
  }
  return diffOpenApi(previous, next);
}

function compareOperation(
  location: string,
  previousPath: { parameters?: Parameter[] },
  previousOp: Operation,
  nextPath: { parameters?: Parameter[] },
  nextOp: Operation,
  before: Document,
  after: Document,
  breaks: BreakingChange[],
): void {
  compareParameters(
    location,
    mergeParams(previousPath.parameters, previousOp.parameters),
    mergeParams(nextPath.parameters, nextOp.parameters),
    before,
    after,
    breaks,
  );
  compareBody(location, previousOp, nextOp, before, after, breaks);
  compareResponses(location, previousOp, nextOp, before, after, breaks);
}

function compareParameters(
  location: string,
  previous: Parameter[],
  next: Parameter[],
  before: Document,
  after: Document,
  breaks: BreakingChange[],
): void {
  const nextByKey = new Map(next.map((parameter) => [paramKey(parameter), parameter]));
  for (const parameter of previous) {
    const key = paramKey(parameter);
    const updated = nextByKey.get(key);
    const where = `${location} parameter ${parameter.in}.${parameter.name}`;
    if (!updated) {
      breaks.push({
        location: where,
        rule: "removed-field",
        detail: `${where} was removed.`,
      });
      continue;
    }
    if (updated.required === true && parameter.required !== true) {
      breaks.push({
        location: where,
        rule: "newly-required",
        detail: `${where} is now required.`,
      });
    }
    compareSchema(where, parameter.schema, updated.schema, before, after, breaks);
  }
}

function compareBody(
  location: string,
  previous: Operation,
  next: Operation,
  before: Document,
  after: Document,
  breaks: BreakingChange[],
): void {
  const previousBody = previous.requestBody;
  const nextBody = next.requestBody;
  if (!previousBody) {
    if (nextBody?.required === true) {
      breaks.push({
        location: `${location} requestBody`,
        rule: "newly-required",
        detail: `${location} now requires a request body.`,
      });
    }
    return;
  }
  if (nextBody?.required === true && previousBody.required !== true) {
    breaks.push({
      location: `${location} requestBody`,
      rule: "newly-required",
      detail: `${location} now requires a request body.`,
    });
  }
  for (const media of JSON_TYPES) {
    const previousSchema = previousBody.content?.[media]?.schema;
    if (!previousSchema) {
      continue;
    }
    const where = `${location} requestBody ${media}`;
    const nextSchema = nextBody?.content?.[media]?.schema;
    if (!nextSchema) {
      breaks.push({
        location: where,
        rule: "removed-field",
        detail: `${where} was removed.`,
      });
      continue;
    }
    compareSchema(where, previousSchema, nextSchema, before, after, breaks);
  }
}

function compareResponses(
  location: string,
  previous: Operation,
  next: Operation,
  before: Document,
  after: Document,
  breaks: BreakingChange[],
): void {
  const previousResponses = previous.responses ?? {};
  const nextResponses = next.responses ?? {};
  for (const status of Object.keys(previousResponses).sort()) {
    if (!status.startsWith("2")) {
      continue;
    }
    const where = `${location} response ${status}`;
    const previousResponse = previousResponses[status];
    const nextResponse = nextResponses[status];
    if (!nextResponse) {
      breaks.push({
        location: where,
        rule: "removed-field",
        detail: `${where} was removed.`,
      });
      continue;
    }
    for (const media of JSON_TYPES) {
      const previousSchema = previousResponse?.content?.[media]?.schema;
      if (!previousSchema) {
        continue;
      }
      const mediaWhere = `${where} ${media}`;
      const nextSchema = nextResponse.content?.[media]?.schema;
      if (!nextSchema) {
        breaks.push({
          location: mediaWhere,
          rule: "removed-field",
          detail: `${mediaWhere} was removed.`,
        });
        continue;
      }
      compareSchema(mediaWhere, previousSchema, nextSchema, before, after, breaks);
    }
  }
}

function compareSchema(
  location: string,
  previous: Schema | undefined,
  next: Schema | undefined,
  before: Document,
  after: Document,
  breaks: BreakingChange[],
  depth = 0,
): void {
  if (!previous) {
    return;
  }
  if (!next) {
    breaks.push({
      location,
      rule: "removed-field",
      detail: `${location} was removed.`,
    });
    return;
  }
  if (depth > 12) {
    return;
  }
  const prev = normalize(previous, before, new Set());
  const updated = normalize(next, after, new Set());
  compareTypes(location, prev, updated, breaks);
  compareEnum(location, prev, updated, breaks);
  compareConstraints(location, prev, updated, breaks);
  compareProperties(location, prev, updated, before, after, breaks, depth);
  if (prev.items || updated.items) {
    compareSchema(`${location} items`, prev.items, updated.items, before, after, breaks, depth + 1);
  }
  compareCombinator(location, "oneOf", prev.oneOf, updated.oneOf, before, after, breaks, depth);
  compareCombinator(location, "anyOf", prev.anyOf, updated.anyOf, before, after, breaks, depth);
}

function compareTypes(
  location: string,
  previous: Schema,
  next: Schema,
  breaks: BreakingChange[],
): void {
  const before = typeSet(previous);
  const after = typeSet(next);
  if (before.size === 0) {
    if (after.size > 0) {
      breaks.push({
        location,
        rule: "narrowed-type",
        detail: `${location} type was narrowed to ${[...after].join("|")}.`,
      });
    }
    return;
  }
  if (after.size === 0) {
    return;
  }
  for (const type of before) {
    if (after.has(type) || (type === "integer" && after.has("number"))) {
      continue;
    }
    breaks.push({
      location,
      rule: "narrowed-type",
      detail: `${location} no longer accepts ${type}.`,
    });
    return;
  }
}

function compareEnum(
  location: string,
  previous: Schema,
  next: Schema,
  breaks: BreakingChange[],
): void {
  if (previous.const !== undefined && !sameJson(previous.const, next.const)) {
    breaks.push({
      location,
      rule: "narrowed-type",
      detail: `${location} const changed.`,
    });
  }
  if (!previous.enum) {
    if (next.enum) {
      breaks.push({
        location,
        rule: "narrowed-type",
        detail: `${location} gained an enum.`,
      });
    }
    return;
  }
  if (!next.enum) {
    return;
  }
  const allowed = new Set(next.enum.map((value) => JSON.stringify(value)));
  for (const value of previous.enum) {
    if (!allowed.has(JSON.stringify(value))) {
      breaks.push({
        location,
        rule: "narrowed-type",
        detail: `${location} dropped enum value ${JSON.stringify(value)}.`,
      });
      return;
    }
  }
}

function compareConstraints(
  location: string,
  previous: Schema,
  next: Schema,
  breaks: BreakingChange[],
): void {
  if (next.format && next.format !== previous.format) {
    breaks.push({
      location,
      rule: "narrowed-type",
      detail: `${location} format changed to ${next.format}.`,
    });
  }
  if (next.pattern && next.pattern !== previous.pattern) {
    breaks.push({
      location,
      rule: "narrowed-type",
      detail: `${location} pattern changed.`,
    });
  }
  tighter(location, "minimum", previous.minimum, next.minimum, breaks, "up");
  tighter(location, "maximum", previous.maximum, next.maximum, breaks, "down");
  tighter(location, "minLength", previous.minLength, next.minLength, breaks, "up");
  tighter(location, "maxLength", previous.maxLength, next.maxLength, breaks, "down");
  tighter(location, "minItems", previous.minItems, next.minItems, breaks, "up");
  tighter(location, "maxItems", previous.maxItems, next.maxItems, breaks, "down");
  const previousExclusiveMin =
    typeof previous.exclusiveMinimum === "number" ? previous.exclusiveMinimum : undefined;
  const nextExclusiveMin =
    typeof next.exclusiveMinimum === "number" ? next.exclusiveMinimum : undefined;
  tighter(location, "exclusiveMinimum", previousExclusiveMin, nextExclusiveMin, breaks, "up");
  const previousExclusiveMax =
    typeof previous.exclusiveMaximum === "number" ? previous.exclusiveMaximum : undefined;
  const nextExclusiveMax =
    typeof next.exclusiveMaximum === "number" ? next.exclusiveMaximum : undefined;
  tighter(location, "exclusiveMaximum", previousExclusiveMax, nextExclusiveMax, breaks, "down");
  if (next.additionalProperties === false && previous.additionalProperties !== false) {
    breaks.push({
      location,
      rule: "narrowed-type",
      detail: `${location} no longer allows additional properties.`,
    });
  }
}

function tighter(
  location: string,
  name: string,
  previous: number | undefined,
  next: number | undefined,
  breaks: BreakingChange[],
  direction: "up" | "down",
): void {
  if (next === undefined) {
    return;
  }
  if (previous === undefined || (direction === "up" ? next > previous : next < previous)) {
    breaks.push({
      location,
      rule: "narrowed-type",
      detail: `${location} ${name} tightened to ${next}.`,
    });
  }
}

function compareProperties(
  location: string,
  previous: Schema,
  next: Schema,
  before: Document,
  after: Document,
  breaks: BreakingChange[],
  depth: number,
): void {
  const previousProps = previous.properties ?? {};
  const nextProps = next.properties ?? {};
  const previousRequired = new Set(previous.required ?? []);
  const nextRequired = new Set(next.required ?? []);
  for (const name of nextRequired) {
    if (!previousRequired.has(name)) {
      breaks.push({
        location: `${location} ${name}`,
        rule: "newly-required",
        detail: `${location} ${name} is now required.`,
      });
    }
  }
  for (const name of Object.keys(previousProps)) {
    const where = `${location} ${name}`;
    if (!nextProps[name]) {
      breaks.push({
        location: where,
        rule: "removed-field",
        detail: `${where} was removed.`,
      });
      continue;
    }
    compareSchema(where, previousProps[name], nextProps[name], before, after, breaks, depth + 1);
  }
}

function compareCombinator(
  location: string,
  name: "oneOf" | "anyOf",
  previous: Schema[] | undefined,
  next: Schema[] | undefined,
  before: Document,
  after: Document,
  breaks: BreakingChange[],
  depth: number,
): void {
  if (!previous || previous.length === 0) {
    return;
  }
  if (!next || next.length === 0) {
    breaks.push({
      location: `${location} ${name}`,
      rule: "narrowed-type",
      detail: `${location} ${name} was removed.`,
    });
    return;
  }
  for (let index = 0; index < previous.length; index += 1) {
    const branch = previous[index];
    const compatible = next.some((candidate) => {
      const nested: BreakingChange[] = [];
      compareSchema(`${location} ${name}`, branch, candidate, before, after, nested, depth + 1);
      return nested.length === 0;
    });
    if (!compatible) {
      breaks.push({
        location: `${location} ${name}[${index}]`,
        rule: "narrowed-type",
        detail: `${location} ${name} branch ${index} was narrowed or removed.`,
      });
    }
  }
}

function normalize(schema: Schema, document: Document, seen: Set<string>): Schema {
  const resolved = resolveRef(schema, document, seen);
  if (!resolved.allOf || resolved.allOf.length === 0) {
    return resolved;
  }
  const parts = resolved.allOf.map((part) => normalize(part, document, seen));
  return mergeAllOf([resolved, ...parts]);
}

function resolveRef(schema: Schema, document: Document, seen: Set<string>): Schema {
  if (!schema.$ref) {
    return schema;
  }
  const name = schema.$ref.replace("#/components/schemas/", "");
  if (seen.has(name)) {
    return { type: "object" };
  }
  const target = document.components?.schemas?.[name];
  if (!target) {
    return schema;
  }
  const nextSeen = new Set(seen);
  nextSeen.add(name);
  return resolveRef(target, document, nextSeen);
}

function mergeAllOf(parts: Schema[]): Schema {
  const properties: Record<string, Schema> = {};
  const required = new Set<string>();
  let type: Schema["type"];
  for (const part of parts) {
    if (part.type) {
      type = part.type;
    }
    for (const [name, schema] of Object.entries(part.properties ?? {})) {
      properties[name] = schema;
    }
    for (const name of part.required ?? []) {
      required.add(name);
    }
  }
  return {
    ...(type ? { type } : {}),
    properties,
    required: [...required],
  };
}

function typeSet(schema: Schema): Set<string> {
  const types = new Set<string>();
  if (Array.isArray(schema.type)) {
    for (const type of schema.type) {
      types.add(type);
    }
  } else if (typeof schema.type === "string") {
    types.add(schema.type);
  }
  if (schema.nullable) {
    types.add("null");
  }
  return types;
}

function mergeParams(
  pathParams: Parameter[] | undefined,
  opParams: Parameter[] | undefined,
): Parameter[] {
  const merged = new Map<string, Parameter>();
  for (const parameter of pathParams ?? []) {
    merged.set(paramKey(parameter), parameter);
  }
  for (const parameter of opParams ?? []) {
    merged.set(paramKey(parameter), parameter);
  }
  return [...merged.values()];
}

function paramKey(parameter: Parameter): string {
  return `${parameter.in}:${parameter.name}`;
}

function isOperation(value: unknown): value is Operation {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asDocument(value: unknown): Document {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Document;
}

function sameJson(left: Json | undefined, right: Json | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
