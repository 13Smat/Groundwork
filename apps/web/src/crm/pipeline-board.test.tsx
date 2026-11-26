// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../session";
import { PipelineBoard, type BoardJob } from "./pipeline-board";

afterEach(() => {
  cleanup();
});

const driveway: BoardJob = {
  id: "018f5a00-0000-7000-8000-000000000201",
  number: "J-1001",
  name: "Driveway",
  stage: "lead",
  client_name: "Ada",
  bid_value_cents: 1500,
};

const summary = [
  { stage: "lead", count: 4, bid_value_cents: 40000 },
  { stage: "estimating", count: 0, bid_value_cents: 0 },
  { stage: "proposed", count: 0, bid_value_cents: 0 },
  { stage: "won", count: 0, bid_value_cents: 0 },
  { stage: "lost", count: 0, bid_value_cents: 0 },
];

function renderBoard(onMove = vi.fn().mockResolvedValue(undefined)) {
  render(
    <PipelineBoard
      jobs={[driveway]}
      summary={summary}
      currency="USD"
      renderJob={(job) => <span>{job.name}</span>}
      onMove={onMove}
    />,
  );
  return onMove;
}

describe("PipelineBoard", () => {
  it("shows the summary count and bid total, not a count of the cards", () => {
    renderBoard();
    expect(screen.getByRole("region", { name: "Lead, 4 jobs, $400.00" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Lead" })).toBeTruthy();
    expect(screen.getByText("Driveway")).toBeTruthy();
    expect(screen.getByText("4 jobs · $400.00")).toBeTruthy();
    expect(screen.getAllByText("No jobs in this stage.").length).toBe(4);
  });

  it("asks for a lost reason and reports a 409 without moving the card", async () => {
    const user = userEvent.setup();
    const onMove = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "Cannot change a job from lead to won."))
      .mockResolvedValueOnce(undefined);
    renderBoard(onMove);

    await user.selectOptions(screen.getByLabelText("Move Driveway"), "won");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Cannot change a job from lead to won.");
    expect(document.activeElement).toBe(alert);
    expect(screen.getByLabelText("Move Driveway")).toBeTruthy();
    expect((screen.getByLabelText("Move Driveway") as HTMLSelectElement).value).toBe("lead");

    await user.selectOptions(screen.getByLabelText("Move Driveway"), "lost");
    const reason = await screen.findByLabelText("Reason");
    expect(document.activeElement).toBe(reason);
    await user.type(reason, "too expensive");
    await user.click(screen.getByRole("button", { name: "Mark lost" }));
    expect(onMove).toHaveBeenLastCalledWith(driveway, "lost", "too expensive");
  });

  it("drops a card on Estimating through the same move handler", async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    renderBoard(onMove);
    const card = screen.getByRole("listitem");
    const dataTransfer = {
      setData: vi.fn(),
      getData: (type: string) => (type === "text/plain" ? driveway.id : ""),
      effectAllowed: "move",
      dropEffect: "move",
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(screen.getByRole("region", { name: /^Estimating/ }), { dataTransfer });
    await screen.findByText("4 jobs · $400.00");
    expect(onMove).toHaveBeenCalledWith(driveway, "estimating");
  });
});
