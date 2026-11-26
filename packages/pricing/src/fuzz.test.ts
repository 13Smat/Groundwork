import { describe, expect, it } from "vitest";

import { evaluateFormula } from "./formula.js";

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz+-*/^()<>=,._ \n\"'`$;{}[]\\";

function randomFormula(random: () => number, length: number): string {
  let formula = "";
  for (let index = 0; index < length; index += 1) {
    formula += ALPHABET[Math.floor(random() * ALPHABET.length)] ?? "x";
  }
  return formula;
}

const ADVERSARIAL = [
  "eval('1')",
  'eval("process.exit(1)")',
  "Function('return 1')()",
  "constructor",
  "constructor.constructor('return 1')()",
  "globalThis.__groundwork_formula_pwned = 1",
  "process.exit(1)",
  "require('child_process')",
  "2^2^2^2^2^2^2^2",
  "((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((1))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))",
  "1/0/0/0/0/0",
  `${"(".repeat(5000)}1${")".repeat(5000)}`,
  "a".repeat(50_000),
  "9^9^9^9^9",
  "min(min(min(min(1,2),3),4),5)",
  "if(if(if(1,1,0),1,0),1,1/0)",
  "\u0000\u0001qty",
  "qty.constructor",
  "1e99",
  "--1",
  "1 <> 2 == 3",
];

describe("formula fuzz", () => {
  it("returns a result for adversarial input in under 50 ms without executing it", () => {
    const random = mulberry32(0x06c0ffee);
    const samples = [...ADVERSARIAL];
    for (let index = 0; index < 200; index += 1) {
      const length = Math.floor(random() * 400);
      samples.push(randomFormula(random, length));
    }
    for (const formula of samples) {
      const started = performance.now();
      const result = evaluateFormula({
        formula,
        inputQty: "1",
        inputUnit: "ft2",
        variables: { depth_in: "2" },
      });
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(50);
      expect(result).toEqual(
        expect.objectContaining({
          ok: expect.any(Boolean),
          errors: expect.any(Array),
          flags: expect.any(Array),
          referencedVars: expect.any(Array),
        }),
      );
    }
    expect(
      (globalThis as { __groundwork_formula_pwned?: unknown }).__groundwork_formula_pwned,
    ).toBeUndefined();
  });
});
