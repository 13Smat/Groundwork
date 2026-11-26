// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageryAdmin, type ImagerySourceRow, type IngestJobView } from "./imagery-page";

afterEach(() => {
  cleanup();
});

const fixture: ImagerySourceRow = {
  id: "018f5a00-0000-7000-8000-000000000007",
  provider: "other",
  name: "fixture_rgbir",
  bands: "RGBIR",
  allowsTracing: true,
  allowsMlTraining: false,
  verifiedAt: "2026-11-25T00:00:00.000Z",
  licenseText: "Synthetic fixture",
  attribution: "Synthetic fixture",
  coverage: { west: -81.71, south: 35.74, east: -81.69, north: 35.76 },
};

describe("ImageryAdmin", () => {
  it("lists license flags and starts an AOI ingest from the keyboard form", async () => {
    const user = userEvent.setup();
    const onIngest = vi.fn();
    render(
      <ImageryAdmin
        sources={[fixture]}
        job={null}
        error={null}
        busy={false}
        onIngest={onIngest}
        onSaveLicense={vi.fn()}
        onCreateSource={vi.fn()}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Tracing" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Allowed" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Verified" })).toBeTruthy();
    expect(screen.getByLabelText("Allow tracing")).toBeTruthy();

    await user.type(screen.getByLabelText("AOI bounding box"), "-81.71,35.74,-81.69,35.76");
    await user.click(screen.getByRole("button", { name: "Start ingest" }));
    expect(onIngest).toHaveBeenCalledWith({
      sourceId: fixture.id,
      year: 2026,
      aoi: {
        type: "Polygon",
        coordinates: [
          [
            [-81.71, 35.74],
            [-81.71, 35.76],
            [-81.69, 35.76],
            [-81.69, 35.74],
            [-81.71, 35.74],
          ],
        ],
      },
    });
  });

  it("refuses a county and an AOI together and announces a failed job", async () => {
    const user = userEvent.setup();
    const onIngest = vi.fn();
    const failed: IngestJobView = {
      jobId: "018f5a00-0000-7000-8000-000000000301",
      status: "failed",
      error: "Live imagery download is disabled.",
      captureDate: null,
      gsdCm: null,
      leaf: null,
      cogKey: null,
    };
    render(
      <ImageryAdmin
        sources={[fixture]}
        job={failed}
        error={null}
        busy={false}
        onIngest={onIngest}
        onSaveLicense={vi.fn()}
        onCreateSource={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("County FIPS"), "37023");
    await user.type(screen.getByLabelText("AOI bounding box"), "-81.71,35.74,-81.69,35.76");
    await user.click(screen.getByRole("button", { name: "Start ingest" }));
    expect(onIngest).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("not both");
    const status = screen.getByRole("region", { name: "Ingest status" });
    expect(status.textContent).toContain("failed");
    expect(status.textContent).toContain("Live imagery download is disabled.");
    expect(screen.getByRole("rowheader", { name: "fixture_rgbir" })).toBeTruthy();
  });
});
