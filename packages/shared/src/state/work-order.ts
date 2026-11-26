export const WORK_ORDER_STATUSES = [
  "ready",
  "scheduled",
  "dispatched",
  "in_progress",
  "done",
  "cancelled",
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

const TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  ready: ["scheduled", "cancelled"],
  scheduled: ["dispatched", "cancelled"],
  dispatched: ["in_progress", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export class IllegalWorkOrderTransitionError extends Error {
  readonly from: WorkOrderStatus;
  readonly to: WorkOrderStatus;

  constructor(from: WorkOrderStatus, to: WorkOrderStatus) {
    super(`Cannot change a work order from ${from} to ${to}.`);
    this.name = "IllegalWorkOrderTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isWorkOrderStatus(value: string): value is WorkOrderStatus {
  return (WORK_ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * Spec 08 creates a work order at `ready` when a proposal is signed.
 * Later slices schedule and dispatch it. The API maps an illegal change to 409.
 */
export function transitionWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): WorkOrderStatus {
  if (from === to || !TRANSITIONS[from].includes(to)) {
    throw new IllegalWorkOrderTransitionError(from, to);
  }
  return to;
}
