import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { BOARD_STAGES, formatCents, jobCountLabel, stageLabel, type BoardStage } from "./format";
import { message } from "./messages";
import { LostReasonDialog, StageMove } from "./stage-move";
import type { StageSummary } from "./types";

export type BoardJob = {
  id: string;
  number: string;
  name: string;
  stage: string;
  client_name: string | null;
  bid_value_cents: number | null;
};

export function PipelineBoard({
  jobs,
  summary,
  currency,
  renderJob,
  onMove,
}: {
  jobs: BoardJob[];
  summary: StageSummary[];
  currency: string;
  renderJob: (job: BoardJob) => ReactNode;
  onMove: (job: BoardJob, to: string, reason?: string) => Promise<void>;
}) {
  const [dropped, setDropped] = useState<BoardJob | null>(null);
  const [dragError, setDragError] = useState("");
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (dragError) {
      alertRef.current?.focus();
    }
  }, [dragError]);

  async function dropOn(stage: BoardStage, jobId: string) {
    const job = jobs.find((item) => item.id === jobId);
    if (!job || job.stage === stage) {
      return;
    }
    if (stage === "lost") {
      setDragError("");
      setDropped(job);
      return;
    }
    try {
      await onMove(job, stage);
      setDragError("");
    } catch (err) {
      setDragError(message(err, "Could not change the stage."));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-base leading-relaxed">
        Drag a job to another column, or use Move to change the stage from the keyboard. Counts and
        bid totals come from the pipeline summary.
      </p>
      {dragError ? (
        <p ref={alertRef} role="alert" tabIndex={-1} className="text-base text-accent">
          {dragError}
        </p>
      ) : null}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {BOARD_STAGES.map((stage) => {
          const row = summary.find((item) => item.stage === stage);
          const count = row?.count ?? 0;
          const total = row?.bid_value_cents ?? 0;
          const money = formatCents(total, currency);
          const columnJobs = jobs.filter((job) => job.stage === stage);
          return (
            <section
              key={stage}
              aria-label={`${stageLabel(stage)}, ${jobCountLabel(count)}, ${money}`}
              className="flex w-72 shrink-0 flex-col gap-3 rounded-md border border-line bg-paper p-3"
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const jobId = event.dataTransfer.getData("text/plain");
                if (jobId) {
                  void dropOn(stage, jobId);
                }
              }}
            >
              <header>
                <h2 className="text-lg font-semibold">{stageLabel(stage)}</h2>
                <p className="text-sm text-muted">
                  {jobCountLabel(count)} · {money}
                </p>
              </header>
              {columnJobs.length === 0 ? (
                <p>No jobs in this stage.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {columnJobs.map((job) => (
                    <li
                      key={job.id}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", job.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      className="flex flex-col gap-2 rounded-md border border-line p-3"
                    >
                      <div className="text-base font-semibold">{renderJob(job)}</div>
                      <p className="text-sm">{job.number}</p>
                      <p className="text-sm">{job.client_name ?? "No client"}</p>
                      <p className="text-sm">
                        {job.bid_value_cents === null
                          ? "No bid"
                          : formatCents(job.bid_value_cents, currency)}
                      </p>
                      <StageMove
                        jobId={job.id}
                        jobName={job.name}
                        stage={job.stage}
                        onMove={(to, reason) => onMove(job, to, reason)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {dropped ? (
        <LostReasonDialog
          jobName={dropped.name}
          error=""
          onOpenChange={(open) => {
            if (!open) {
              setDropped(null);
            }
          }}
          onSubmit={async (reason) => {
            await onMove(dropped, "lost", reason);
            setDropped(null);
          }}
        />
      ) : null}
    </div>
  );
}
