import { describe, expect, it } from "vitest";

import {
  IllegalWorkOrderTransitionError,
  isWorkOrderStatus,
  transitionWorkOrder,
} from "./work-order.js";

describe("work order status", () => {
  it("walks ready to done and allows cancel before done", () => {
    expect(transitionWorkOrder("ready", "scheduled")).toBe("scheduled");
    expect(transitionWorkOrder("scheduled", "dispatched")).toBe("dispatched");
    expect(transitionWorkOrder("dispatched", "in_progress")).toBe("in_progress");
    expect(transitionWorkOrder("in_progress", "done")).toBe("done");
    expect(transitionWorkOrder("ready", "cancelled")).toBe("cancelled");
    expect(transitionWorkOrder("in_progress", "cancelled")).toBe("cancelled");
  });

  it("refuses a skip and any leave from done or cancelled", () => {
    expect(() => transitionWorkOrder("ready", "done")).toThrow(IllegalWorkOrderTransitionError);
    expect(() => transitionWorkOrder("done", "cancelled")).toThrow(IllegalWorkOrderTransitionError);
    expect(() => transitionWorkOrder("cancelled", "ready")).toThrow(
      IllegalWorkOrderTransitionError,
    );
    expect(isWorkOrderStatus("ready")).toBe(true);
    expect(isWorkOrderStatus("signed")).toBe(false);
  });
});
