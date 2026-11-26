import { Button, Dialog, DialogClose, DialogContent, SelectField, TextField } from "@groundwork/ui";
import { type FormEvent, forwardRef, useEffect, useId, useRef, useState } from "react";

import { BOARD_STAGES, isBoardStage, stageLabel } from "./format";
import { message } from "./messages";

const Alert = forwardRef<HTMLParagraphElement, { message: string }>(function Alert(
  { message: text },
  ref,
) {
  return (
    <p ref={ref} role="alert" tabIndex={-1} className="text-base text-accent">
      {text}
    </p>
  );
});

export function LostReasonDialog({
  jobName,
  error,
  onSubmit,
  onOpenChange,
}: {
  jobName: string;
  error: string;
  onSubmit: (reason: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const fieldId = useId();
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const shown = error || localError;

  async function onConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason === "") {
      setLocalError("A lost job needs a reason.");
      return;
    }
    setBusy(true);
    setLocalError("");
    try {
      await onSubmit(reason);
    } catch (err) {
      setLocalError(message(err, "Could not mark the job lost."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title="Why was this job lost?"
        description={`The stage for ${jobName} stays where it is until you save a reason.`}
        initialFocusId={fieldId}
      >
        <form onSubmit={onConfirm} className="flex flex-col gap-4">
          <TextField id={fieldId} name="reason" label="Reason" required maxLength={500} />
          {shown ? <Alert message={shown} /> : null}
          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>
              Mark lost
            </Button>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StageMove({
  jobId,
  jobName,
  stage,
  onMove,
}: {
  jobId: string;
  jobName: string;
  stage: string;
  onMove: (to: string, reason?: string) => Promise<void>;
}) {
  const [lost, setLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState("");
  const alertRef = useRef<HTMLParagraphElement>(null);
  const options = isBoardStage(stage) ? BOARD_STAGES : [...BOARD_STAGES, stage];

  useEffect(() => {
    if (conflict) {
      alertRef.current?.focus();
    }
  }, [conflict]);

  async function requestMove(to: string) {
    if (to === stage) {
      return;
    }
    if (to === "lost") {
      setConflict("");
      setLost(true);
      return;
    }
    setBusy(true);
    setConflict("");
    try {
      await onMove(to);
    } catch (err) {
      setConflict(message(err, "Could not change the stage."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <SelectField
        id={`move-${jobId}`}
        label={`Move ${jobName}`}
        value={stage}
        disabled={busy}
        onChange={(event) => {
          void requestMove(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {stageLabel(option)}
          </option>
        ))}
      </SelectField>
      {conflict ? <Alert ref={alertRef} message={conflict} /> : null}
      {lost ? (
        <LostReasonDialog
          jobName={jobName}
          error=""
          onOpenChange={(open) => {
            if (!open) {
              setLost(false);
            }
          }}
          onSubmit={async (reason) => {
            await onMove("lost", reason);
            setLost(false);
          }}
        />
      ) : null}
    </div>
  );
}
