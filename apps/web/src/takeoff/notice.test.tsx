// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NO_CAPTURE_MESSAGE } from "./imagery";
import { ImageryNotice } from "./notice";
import { TakeoffStart } from "./start";
import type { ImageryCapture } from "./types";

afterEach(() => {
  cleanup();
});

const HELENE: ImageryCapture = {
  id: "018f5a00-0000-7000-8000-000000000101",
  sourceId: "018f5a00-0000-7000-8000-000000000001",
  provider: "nc_helene_2025",
  name: "nc_helene_2025",
  captureDate: "2025-04-15",
  gsdCm: 15.24,
  bands: "RGBIR",
  leaf: "off",
  attribution: "NC Collaboratory at UNC Chapel Hill",
  ageDays: 590,
  warnings: [
    "This capture is more than 12 months old. New construction may be missing.",
    "Seamline smears are possible off major roads.",
  ],
};

const NAIP: ImageryCapture = {
  ...HELENE,
  id: "018f5a00-0000-7000-8000-000000000104",
  provider: "naip",
  name: "naip",
  captureDate: "2023-07-01",
  gsdCm: 60,
  leaf: "on",
  attribution: "USDA NAIP",
  ageDays: 1244,
  warnings: [
    "This capture is more than 12 months old. New construction may be missing.",
    "This capture is approaching 4 years old. Outlines may be stale.",
    "Lower resolution (60 cm, leaf-on).",
  ],
};

describe("imagery notice", () => {
  it("shows capture date, ground sample distance, attribution, and the age warning", () => {
    render(<ImageryNotice capture={HELENE} />);
    expect(screen.getByText("2025-04-15")).toBeTruthy();
    expect(screen.getByText("6 in (15.24 cm)")).toBeTruthy();
    expect(screen.getByText("NC Collaboratory at UNC Chapel Hill")).toBeTruthy();
    expect(screen.getByText("Leaf-off")).toBeTruthy();
    expect(
      screen.getByText("This capture is more than 12 months old. New construction may be missing."),
    ).toBeTruthy();
    expect(screen.getByText("Seamline smears are possible off major roads.")).toBeTruthy();
  });

  it("shows the stronger age warning and the NAIP banner when the capture carries them", () => {
    render(<ImageryNotice capture={NAIP} />);
    expect(screen.getByText("60 cm")).toBeTruthy();
    expect(
      screen.getByText("This capture is approaching 4 years old. Outlines may be stale."),
    ).toBeTruthy();
    expect(screen.getByText("Lower resolution (60 cm, leaf-on).")).toBeTruthy();
  });
});

describe("takeoff start", () => {
  it("blocks measuring when no allowed capture covers the site", () => {
    render(
      <TakeoffStart
        captures={[]}
        loading={false}
        creating={false}
        error=""
        remembered={[]}
        onCreate={() => undefined}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(NO_CAPTURE_MESSAGE);
    expect(screen.getByRole("button", { name: "New takeoff" }).hasAttribute("disabled")).toBe(true);
  });

  it("offers the newest allowed capture", () => {
    render(
      <TakeoffStart
        captures={[HELENE]}
        loading={false}
        creating={false}
        error=""
        remembered={[]}
        onCreate={() => undefined}
        onOpen={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "New takeoff" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.getByText("NC Collaboratory at UNC Chapel Hill")).toBeTruthy();
  });
});
