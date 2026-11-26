// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssistPanel } from "./assist-panel";

afterEach(() => {
  cleanup();
});

const props = {
  on: false,
  prompt: "off" as const,
  busy: false,
  canReview: false,
  overlap: false,
  status: "",
  alert: "",
  readOnly: false,
  onToggle: () => undefined,
  onPrompt: () => undefined,
  onAccept: () => undefined,
  onRefine: () => undefined,
  onDiscard: () => undefined,
};

describe("assist controls", () => {
  it("renders nothing when the workspace flag is off", () => {
    render(<AssistPanel {...props} enabled={false} />);
    expect(screen.queryByRole("checkbox", { name: "Assist" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refine" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });

  it("hides the prompt and review actions until Assist is on and a draft exists", () => {
    const { rerender } = render(<AssistPanel {...props} enabled on={false} />);
    expect(screen.getByRole("checkbox", { name: "Assist" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Positive point" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();

    rerender(<AssistPanel {...props} enabled on prompt="positive" />);
    expect(screen.getByRole("radio", { name: "Positive point" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Negative point" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Box" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();

    rerender(
      <AssistPanel
        {...props}
        enabled
        on
        prompt="positive"
        canReview
        overlap
        status="Draft polygon. Dashed until you accept."
      />,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refine" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
    expect(
      screen.getByText("This draft overlaps a measurement. Accepting keeps both."),
    ).toBeTruthy();
  });
});
