// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { AppShell } from "./shell";
import { PrimaryNav } from "./nav";
import { SelectField } from "./select-field";
import { TextField } from "./text-field";

afterEach(() => {
  cleanup();
});

const items = [
  { href: "/", label: "Office" },
  { href: "/jobs", label: "Jobs" },
  { href: "/estimates", label: "Estimates" },
] as const;

describe("PrimaryNav", () => {
  it("marks the current page and moves focus with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<PrimaryNav items={items} currentPath="/jobs" />);

    const office = screen.getByRole("link", { name: "Office" });
    const jobs = screen.getByRole("link", { name: "Jobs" });
    const estimates = screen.getByRole("link", { name: "Estimates" });
    expect(jobs.getAttribute("aria-current")).toBe("page");
    expect(office.getAttribute("aria-current")).toBeNull();

    office.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(jobs);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(estimates);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(office);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(estimates);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(office);
  });
});

describe("AppShell", () => {
  it("opens keyboard help and closes it with Escape", async () => {
    const user = userEvent.setup();
    render(
      <AppShell title="Office" nav={<PrimaryNav items={items} currentPath="/" />}>
        <p>Hello</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe(
      "#main",
    );
    expect(screen.getByRole("heading", { name: "Office" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Keyboard help" }));
    expect(screen.getByRole("dialog", { name: "Keyboard help" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SelectField", () => {
  it("connects the label to the select", () => {
    render(
      <SelectField id="role" label="Role">
        <option value="crew">Crew</option>
      </SelectField>,
    );
    expect(screen.getByLabelText("Role").id).toBe("role");
  });
});

describe("TextField", () => {
  it("connects the label to the input", () => {
    render(<TextField id="notes" label="Notes" />);
    expect(screen.getByLabelText("Notes").id).toBe("notes");
  });
});
