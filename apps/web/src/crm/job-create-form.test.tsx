// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobCreateForm } from "./job-create-form";
import type { AddressLookup } from "./types";

afterEach(() => {
  cleanup();
});

const resolved: AddressLookup = {
  addressText: "100 Main St, Morganton, NC 28655",
  formatted: "100 Main St, Morganton, NC 28655",
  line1: "100 Main St",
  point: { lat: 35.748741, lng: -81.702576 },
  warning: null,
};

function form(lookup: AddressLookup | null, onLookup = vi.fn(), onCreate = vi.fn()) {
  return (
    <JobCreateForm
      clients={[]}
      members={[{ id: "member-1", name: "Pat Owner", email: "pat@example.com" }]}
      currentMemberId="member-1"
      currency="USD"
      lookup={lookup}
      lookingUp={false}
      submitting={false}
      error={null}
      onLookup={onLookup}
      onCreate={onCreate}
      mapEnabled={false}
    />
  );
}

describe("JobCreateForm", () => {
  it("fills the job name from a resolved address and creates a client", async () => {
    const user = userEvent.setup();
    const onLookup = vi.fn();
    const onCreate = vi.fn();
    const view = render(form(null, onLookup, onCreate));
    await user.type(screen.getByLabelText("Site address"), resolved.addressText);
    await user.click(screen.getByRole("button", { name: "Look up address" }));
    expect(onLookup).toHaveBeenCalledWith(resolved.addressText);

    view.rerender(form(resolved, onLookup, onCreate));
    expect((screen.getByLabelText("Job name") as HTMLInputElement).value).toBe("100 Main St");
    expect(screen.getByText("Site: 100 Main St, Morganton, NC 28655")).toBeTruthy();
    await user.type(screen.getByLabelText("Client name"), "Morganton Homes");
    await user.click(screen.getByRole("button", { name: "Create job" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "100 Main St",
        address: resolved.addressText,
        point: { lat: 35.748741, lng: -81.702576 },
        client: expect.objectContaining({ name: "Morganton Homes", type: "residential" }),
      }),
    );
  });

  it("shows latitude and longitude when the address cannot be geocoded", async () => {
    const user = userEvent.setup();
    const missed: AddressLookup = {
      addressText: "1 Uncoded Ridge",
      formatted: null,
      line1: null,
      point: null,
      warning: "Address could not be geocoded. Drop a pin to set the site.",
    };
    const view = render(form(null));
    await user.type(screen.getByLabelText("Site address"), missed.addressText);
    view.rerender(form(missed));
    expect(screen.getByLabelText("Latitude")).toBeTruthy();
    expect(screen.getByLabelText("Longitude")).toBeTruthy();
    expect(screen.getByText(/could not be geocoded/)).toBeTruthy();
  });
});
