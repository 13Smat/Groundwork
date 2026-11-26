import { describe, expect, it } from "vitest";

import { likeContains, phoneDigits, searchMode } from "./query.js";

describe("crm search query", () => {
  it("keeps digits from a formatted phone", () => {
    expect(phoneDigits("(919) 555-0142")).toBe("9195550142");
    expect(phoneDigits("")).toBe("");
  });

  it("classifies job numbers, phones, and text separately", () => {
    expect(searchMode("J-1001")).toBe("number");
    expect(searchMode("j-42424")).toBe("number");
    expect(searchMode("9195550142")).toBe("phone");
    expect(searchMode("(919) 555-0142")).toBe("phone");
    expect(searchMode("Evergreen")).toBe("text");
    expect(searchMode("100 Main")).toBe("text");
    expect(searchMode("555")).toBe("text");
  });

  it("escapes like wildcards", () => {
    expect(likeContains("100% Main_St")).toBe("%100\\% Main\\_St%");
  });
});
