import { conversionRatio, measureKindOfUnit } from "@groundwork/geo";
import { Decimal } from "decimal.js";

/**
 * Cost-recipe formulas. Recursive descent only: nothing here calls eval or
 * Function. Decimal.js stays exact until a caller rounds money.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

const MAX_FORMULA_LENGTH = 2_000;
const MAX_NODES = 256;
const MAX_DEPTH = 64;
const MAX_STEPS = 2_000;
const MAX_EVAL_MS = 20;
const MAX_ABS_EXPONENT = 16;
const MAX_CALL_ARGS = 16;

const FUNCTIONS = new Set(["ceil", "floor", "round", "min", "max", "if"]);

export const BUILTIN_VARIABLES = [
  "qty",
  "area_ft2",
  "area_yd2",
  "area_m2",
  "length_ft",
  "length_m",
  "count",
] as const;

export type BuiltinVariable = (typeof BUILTIN_VARIABLES)[number];

const BUILTIN_SET = new Set<string>(BUILTIN_VARIABLES);

export type FormulaDiagnostic = {
  message: string;
  position: number;
  length: number;
};

export type FormulaFlag = "division_by_zero" | "complexity";

export type FormulaValidation = {
  ok: boolean;
  errors: FormulaDiagnostic[];
  referencedVars: string[];
};

export type FormulaEvaluation = {
  ok: boolean;
  value: string | null;
  flags: FormulaFlag[];
  errors: FormulaDiagnostic[];
  referencedVars: string[];
};

type Token =
  | { type: "num"; value: string; pos: number }
  | { type: "id"; value: string; pos: number }
  | { type: "op"; value: string; pos: number }
  | { type: "lparen"; pos: number }
  | { type: "rparen"; pos: number }
  | { type: "comma"; pos: number }
  | { type: "eof"; pos: number };

type Node =
  | { type: "num"; value: string; pos: number }
  | { type: "var"; name: string; pos: number }
  | { type: "unary"; expr: Node; pos: number }
  | { type: "binary"; op: string; left: Node; right: Node; pos: number }
  | { type: "call"; name: string; args: Node[]; pos: number };

const COMPARISONS = new Set(["<", ">", "<=", ">=", "=", "==", "!=", "<>"]);

class FormulaSyntaxError extends Error {
  readonly position: number;
  readonly length: number;

  constructor(message: string, position: number, length = 1) {
    super(message);
    this.name = "FormulaSyntaxError";
    this.position = position;
    this.length = length;
  }
}

class FormulaFlagError extends Error {
  readonly flag: FormulaFlag;

  constructor(flag: FormulaFlag) {
    super(flag);
    this.name = "FormulaFlagError";
    this.flag = flag;
  }
}

class UnknownVariableError extends Error {
  readonly variable: string;
  readonly position: number;

  constructor(variable: string, position: number) {
    super(`Unknown variable ${variable}.`);
    this.name = "UnknownVariableError";
    this.variable = variable;
    this.position = position;
  }
}

function isIdentStart(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || char === "_";
}

function isIdentPart(char: string): boolean {
  return isIdentStart(char) || (char >= "0" && char <= "9");
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index]!;
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    const pos = index;
    if (char === "(") {
      tokens.push({ type: "lparen", pos });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen", pos });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma", pos });
      index += 1;
      continue;
    }
    if (isDigit(char)) {
      let end = index + 1;
      while (isDigit(input[end])) {
        end += 1;
      }
      if (input[end] === "." && isDigit(input[end + 1])) {
        end += 2;
        while (isDigit(input[end])) {
          end += 1;
        }
      }
      tokens.push({ type: "num", value: input.slice(index, end), pos });
      index = end;
      continue;
    }
    if (isIdentStart(char)) {
      let end = index + 1;
      while (isIdentPart(input[end] ?? "")) {
        end += 1;
      }
      tokens.push({ type: "id", value: input.slice(index, end), pos });
      index = end;
      continue;
    }
    const two = input.slice(index, index + 2);
    if (two === "<=" || two === ">=" || two === "==" || two === "!=" || two === "<>") {
      tokens.push({ type: "op", value: two, pos });
      index += 2;
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "^") {
      tokens.push({ type: "op", value: char, pos });
      index += 1;
      continue;
    }
    if (char === "<" || char === ">" || char === "=") {
      tokens.push({ type: "op", value: char, pos });
      index += 1;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected ${JSON.stringify(char)}.`, pos, 1);
  }
  tokens.push({ type: "eof", pos: input.length });
  return tokens;
}

class Parser {
  private cursor = 0;
  private nodes = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.parseComparison();
    const token = this.peek();
    if (token.type !== "eof") {
      throw new FormulaSyntaxError("Unexpected token.", token.pos, 1);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.cursor] ?? { type: "eof", pos: 0 };
  }

  private take(): Token {
    const token = this.peek();
    this.cursor += 1;
    return token;
  }

  private parseComparison(): Node {
    const left = this.parseAdditive();
    const op = this.peek();
    if (op.type === "op" && COMPARISONS.has(op.value)) {
      this.take();
      const right = this.parseAdditive();
      const chained = this.peek();
      if (chained.type === "op" && COMPARISONS.has(chained.value)) {
        throw new FormulaSyntaxError("Chained comparisons are not supported.", chained.pos, 1);
      }
      return this.node({ type: "binary", op: op.value, left, right, pos: op.pos });
    }
    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseTerm();
    for (;;) {
      const op = this.peek();
      if (op.type !== "op" || (op.value !== "+" && op.value !== "-")) {
        return left;
      }
      this.take();
      const right = this.parseTerm();
      left = this.node({ type: "binary", op: op.value, left, right, pos: op.pos });
    }
  }

  private parseTerm(): Node {
    let left = this.parseUnary();
    for (;;) {
      const op = this.peek();
      if (op.type !== "op" || (op.value !== "*" && op.value !== "/")) {
        return left;
      }
      this.take();
      const right = this.parseUnary();
      left = this.node({ type: "binary", op: op.value, left, right, pos: op.pos });
    }
  }

  /**
   * Power binds tighter than unary minus, so `-2^2` is `-(2^2)`.
   * The exponent is a unary so `2^-3` and right-associative `2^3^2` both parse.
   */
  private parsePower(): Node {
    const base = this.parsePrimary();
    const op = this.peek();
    if (op.type === "op" && op.value === "^") {
      this.take();
      const exponent = this.parseUnary();
      return this.node({ type: "binary", op: "^", left: base, right: exponent, pos: op.pos });
    }
    return base;
  }

  private parseUnary(): Node {
    const op = this.peek();
    if (op.type === "op" && op.value === "-") {
      this.take();
      const expr = this.parseUnary();
      return this.node({ type: "unary", expr, pos: op.pos });
    }
    return this.parsePower();
  }

  private parsePrimary(): Node {
    const token = this.take();
    if (token.type === "num") {
      return this.node({ type: "num", value: token.value, pos: token.pos });
    }
    if (token.type === "id") {
      if (this.peek().type === "lparen") {
        return this.parseCall(token.value, token.pos);
      }
      if (FUNCTIONS.has(token.value)) {
        throw new FormulaSyntaxError(
          `${token.value} is a function and needs parentheses.`,
          token.pos,
          token.value.length,
        );
      }
      return this.node({ type: "var", name: token.value, pos: token.pos });
    }
    if (token.type === "lparen") {
      this.depth += 1;
      if (this.depth > MAX_DEPTH) {
        throw new FormulaSyntaxError("Formula is too complex.", token.pos, 1);
      }
      const inner = this.parseComparison();
      const close = this.take();
      this.depth -= 1;
      if (close.type !== "rparen") {
        throw new FormulaSyntaxError("Expected ).", close.pos, 1);
      }
      return inner;
    }
    if (token.type === "eof") {
      throw new FormulaSyntaxError("Formula ended early.", token.pos, 1);
    }
    throw new FormulaSyntaxError("Expected a number, variable, or (.", token.pos, 1);
  }

  private parseCall(name: string, pos: number): Node {
    if (!FUNCTIONS.has(name)) {
      throw new FormulaSyntaxError(`Unknown function ${name}.`, pos, name.length);
    }
    const open = this.take();
    if (open.type !== "lparen") {
      throw new FormulaSyntaxError("Expected (.", open.pos, 1);
    }
    const args: Node[] = [];
    if (this.peek().type !== "rparen") {
      for (;;) {
        args.push(this.parseComparison());
        if (args.length > MAX_CALL_ARGS) {
          throw new FormulaSyntaxError("Too many arguments.", pos, name.length);
        }
        if (this.peek().type !== "comma") {
          break;
        }
        this.take();
      }
    }
    const close = this.take();
    if (close.type !== "rparen") {
      throw new FormulaSyntaxError("Expected ).", close.pos, 1);
    }
    const expected = expectedArity(name);
    if (args.length < expected.min || args.length > expected.max) {
      throw new FormulaSyntaxError(`${name} expects ${expected.label}.`, pos, name.length);
    }
    return this.node({ type: "call", name, args, pos });
  }

  private node<T extends Node>(value: T): T {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) {
      throw new FormulaSyntaxError("Formula is too complex.", value.pos, 1);
    }
    return value;
  }
}

function expectedArity(name: string): { min: number; max: number; label: string } {
  if (name === "if") {
    return { min: 3, max: 3, label: "3 arguments" };
  }
  if (name === "round") {
    return { min: 1, max: 2, label: "1 or 2 arguments" };
  }
  if (name === "min" || name === "max") {
    return { min: 2, max: MAX_CALL_ARGS, label: "at least 2 arguments" };
  }
  return { min: 1, max: 1, label: "1 argument" };
}

function parseFormula(formula: string): Node {
  if (formula.length > MAX_FORMULA_LENGTH) {
    throw new FormulaSyntaxError("Formula is too long.", MAX_FORMULA_LENGTH, 1);
  }
  if (formula.trim() === "") {
    throw new FormulaSyntaxError("Formula is empty.", 0, 0);
  }
  return new Parser(tokenize(formula)).parse();
}

function collectVars(node: Node, into: Map<string, FormulaDiagnostic>): void {
  switch (node.type) {
    case "var":
      if (!into.has(node.name)) {
        into.set(node.name, {
          message: node.name,
          position: node.pos,
          length: node.name.length,
        });
      }
      return;
    case "unary":
      collectVars(node.expr, into);
      return;
    case "binary":
      collectVars(node.left, into);
      collectVars(node.right, into);
      return;
    case "call":
      for (const arg of node.args) {
        collectVars(arg, into);
      }
      return;
    default:
      return;
  }
}

function referencedNames(node: Node): string[] {
  const found = new Map<string, FormulaDiagnostic>();
  collectVars(node, found);
  return [...found.keys()];
}

export function isDecimalString(value: string): boolean {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

export function validateFormula(formula: string, variables: readonly string[]): FormulaValidation {
  let tree: Node;
  try {
    tree = parseFormula(formula);
  } catch (error) {
    if (error instanceof FormulaSyntaxError) {
      return {
        ok: false,
        errors: [{ message: error.message, position: error.position, length: error.length }],
        referencedVars: [],
      };
    }
    throw error;
  }
  const referencedVars = referencedNames(tree);
  const known = new Set<string>([...BUILTIN_SET, ...variables]);
  const errors: FormulaDiagnostic[] = [];
  const located = new Map<string, FormulaDiagnostic>();
  collectVars(tree, located);
  for (const name of referencedVars) {
    if (known.has(name)) {
      continue;
    }
    const at = located.get(name);
    errors.push({
      message: `Unknown variable ${name}.`,
      position: at?.position ?? 0,
      length: at?.length ?? name.length,
    });
  }
  for (const name of variables) {
    if (BUILTIN_SET.has(name) || FUNCTIONS.has(name)) {
      errors.push({
        message: `${name} is reserved.`,
        position: 0,
        length: 0,
      });
    }
  }
  return { ok: errors.length === 0, errors, referencedVars };
}

class Budget {
  private steps = 0;
  private readonly started = performance.now();

  tick(): void {
    this.steps += 1;
    if (this.steps > MAX_STEPS || performance.now() - this.started > MAX_EVAL_MS) {
      throw new FormulaFlagError("complexity");
    }
  }
}

function compare(op: string, left: Decimal, right: Decimal): Decimal {
  const result =
    op === "<"
      ? left.lt(right)
      : op === ">"
        ? left.gt(right)
        : op === "<="
          ? left.lte(right)
          : op === ">="
            ? left.gte(right)
            : op === "!=" || op === "<>"
              ? !left.eq(right)
              : left.eq(right);
  return result ? new D(1) : new D(0);
}

function guardedPow(base: Decimal, exponent: Decimal): Decimal {
  if (!exponent.isInteger() || exponent.abs().gt(MAX_ABS_EXPONENT) || base.abs().gt("1e12")) {
    throw new FormulaFlagError("complexity");
  }
  if (base.isZero() && exponent.isNegative()) {
    throw new FormulaFlagError("division_by_zero");
  }
  return base.pow(exponent.toNumber());
}

function evalNode(node: Node, env: Map<string, Decimal>, budget: Budget): Decimal {
  budget.tick();
  switch (node.type) {
    case "num":
      return new D(node.value);
    case "var": {
      const value = env.get(node.name);
      if (value === undefined) {
        throw new UnknownVariableError(node.name, node.pos);
      }
      return value;
    }
    case "unary":
      return evalNode(node.expr, env, budget).neg();
    case "binary": {
      if (node.op === "^") {
        return guardedPow(evalNode(node.left, env, budget), evalNode(node.right, env, budget));
      }
      const left = evalNode(node.left, env, budget);
      const right = evalNode(node.right, env, budget);
      if (node.op === "+") {
        return left.add(right);
      }
      if (node.op === "-") {
        return left.sub(right);
      }
      if (node.op === "*") {
        return left.mul(right);
      }
      if (node.op === "/") {
        if (right.isZero()) {
          throw new FormulaFlagError("division_by_zero");
        }
        return left.div(right);
      }
      return compare(node.op, left, right);
    }
    case "call":
      return evalCall(node, env, budget);
    default:
      throw new FormulaFlagError("complexity");
  }
}

function evalCall(
  node: Extract<Node, { type: "call" }>,
  env: Map<string, Decimal>,
  budget: Budget,
): Decimal {
  if (node.name === "if") {
    const condition = node.args[0];
    const whenTrue = node.args[1];
    const whenFalse = node.args[2];
    if (!condition || !whenTrue || !whenFalse) {
      throw new FormulaFlagError("complexity");
    }
    const flag = evalNode(condition, env, budget);
    return evalNode(flag.isZero() ? whenFalse : whenTrue, env, budget);
  }
  const args = node.args.map((arg) => evalNode(arg, env, budget));
  if (node.name === "ceil") {
    return args[0]!.ceil();
  }
  if (node.name === "floor") {
    return args[0]!.floor();
  }
  if (node.name === "round") {
    const places = args[1];
    if (!places) {
      return args[0]!.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
    }
    if (!places.isInteger() || places.isNegative() || places.gt(8)) {
      throw new FormulaFlagError("complexity");
    }
    return args[0]!.toDecimalPlaces(places.toNumber(), Decimal.ROUND_HALF_EVEN);
  }
  if (node.name === "min") {
    return args.reduce((best, item) => (item.lt(best) ? item : best));
  }
  if (node.name === "max") {
    return args.reduce((best, item) => (item.gt(best) ? item : best));
  }
  throw new FormulaFlagError("complexity");
}

function convertTo(qty: Decimal, from: string, to: string): Decimal {
  const ratio = conversionRatio(from, to);
  return qty.mul(ratio.numerator).div(ratio.denominator);
}

/**
 * Built-ins for the input's measure kind. Area formulas do not see length
 * variables, and the reverse. `qty` is the quantity in `inputUnit`.
 */
function builtinDecimals(inputQty: string, inputUnit: string): Map<string, Decimal> {
  if (!isDecimalString(inputQty)) {
    throw new FormulaSyntaxError("Input quantity must be a decimal.", 0, 0);
  }
  const kind = measureKindOfUnit(inputUnit);
  if (!kind) {
    throw new FormulaSyntaxError(`Unknown measure unit ${inputUnit}.`, 0, 0);
  }
  const qty = new D(inputQty);
  const values = new Map<string, Decimal>([["qty", qty]]);
  if (kind === "area") {
    values.set("area_m2", convertTo(qty, inputUnit, "m2"));
    values.set("area_ft2", convertTo(qty, inputUnit, "ft2"));
    values.set("area_yd2", convertTo(qty, inputUnit, "yd2"));
  } else if (kind === "length") {
    values.set("length_m", convertTo(qty, inputUnit, "m"));
    values.set("length_ft", convertTo(qty, inputUnit, "ft"));
  } else {
    values.set("count", qty);
  }
  return values;
}

export function builtinValues(inputQty: string, inputUnit: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of builtinDecimals(inputQty, inputUnit)) {
    values[name] = formatDecimal(value);
  }
  return values;
}

export function formatDecimal(value: Decimal): string {
  const fixed = value.toFixed(28);
  if (!fixed.includes(".")) {
    return fixed;
  }
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  if (trimmed === "" || trimmed === "-" || trimmed === "-0") {
    return "0";
  }
  return trimmed;
}

export function roundHalfEvenCents(amount: Decimal): bigint {
  return BigInt(amount.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toFixed(0));
}

function failure(
  referencedVars: string[],
  errors: FormulaDiagnostic[],
  flags: FormulaFlag[],
  value: string | null,
): FormulaEvaluation {
  return { ok: false, value, flags, errors, referencedVars };
}

export function evaluateFormula(input: {
  formula: string;
  inputQty: string;
  inputUnit: string;
  variables?: Record<string, string>;
}): FormulaEvaluation {
  const userVariables = input.variables ?? {};
  const validation = validateFormula(input.formula, Object.keys(userVariables));
  if (!validation.ok) {
    return failure(validation.referencedVars, validation.errors, [], null);
  }
  let env: Map<string, Decimal>;
  try {
    env = builtinDecimals(input.inputQty, input.inputUnit);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid input.";
    return failure(validation.referencedVars, [{ message, position: 0, length: 0 }], [], null);
  }
  for (const name of validation.referencedVars) {
    if (!env.has(name) && !Object.hasOwn(userVariables, name)) {
      const at = input.formula.indexOf(name);
      return failure(
        validation.referencedVars,
        [
          {
            message: `Unknown variable ${name}.`,
            position: at >= 0 ? at : 0,
            length: name.length,
          },
        ],
        [],
        null,
      );
    }
  }
  for (const [name, value] of Object.entries(userVariables)) {
    if (!isDecimalString(value)) {
      return failure(
        validation.referencedVars,
        [{ message: `${name} must be a decimal.`, position: 0, length: 0 }],
        [],
        null,
      );
    }
    if (!env.has(name)) {
      env.set(name, new D(value));
    }
  }
  try {
    const tree = parseFormula(input.formula);
    const value = evalNode(tree, env, new Budget());
    return {
      ok: true,
      value: formatDecimal(value),
      flags: [],
      errors: [],
      referencedVars: validation.referencedVars,
    };
  } catch (error) {
    if (error instanceof FormulaFlagError) {
      return failure(
        validation.referencedVars,
        [],
        [error.flag],
        error.flag === "division_by_zero" ? "0" : null,
      );
    }
    if (error instanceof UnknownVariableError) {
      return failure(
        validation.referencedVars,
        [
          {
            message: error.message,
            position: error.position,
            length: error.variable.length,
          },
        ],
        [],
        null,
      );
    }
    if (error instanceof FormulaSyntaxError) {
      return failure(
        validation.referencedVars,
        [{ message: error.message, position: error.position, length: error.length }],
        [],
        null,
      );
    }
    throw error;
  }
}
