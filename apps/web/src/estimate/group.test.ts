import { describe, expect, it } from "vitest";

import { groupLines, overrideMap, variableKeys } from "./group";

describe("estimate line groups", () => {
  it("keeps takeoff groups and puts a blank manual group last in encounter order", () => {
    const groups = groupLines([
      { group: "Asphalt surface", source: "recipe" },
      { group: "Asphalt surface", source: "recipe" },
      { group: null, source: "manual" },
      { group: "Mobilization", source: "manual" },
    ]);
    expect(groups.map((group) => group.title)).toEqual([
      "Asphalt surface",
      "Manual",
      "Mobilization",
    ]);
    expect(groups[0]?.lines).toHaveLength(2);
  });

  it("drops an override that matches the recipe default", () => {
    const line = {
      variables: { depth_in: "3" },
      recipe_variables: { depth_in: "2", waste: "0.05" },
    };
    expect(variableKeys(line)).toEqual(["depth_in", "waste"]);
    expect(overrideMap(line, "depth_in", "2")).toEqual({});
    expect(overrideMap(line, "waste", "0.1")).toEqual({ depth_in: "3", waste: "0.1" });
  });
});
