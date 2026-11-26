import { Button } from "@groundwork/ui";

import type { AssistPromptMode } from "./assist-layer";

const PROMPTS: { id: Exclude<AssistPromptMode, "off">; label: string }[] = [
  { id: "positive", label: "Positive point" },
  { id: "negative", label: "Negative point" },
  { id: "box", label: "Box" },
];

export function AssistPanel({
  enabled,
  on,
  prompt,
  busy,
  canReview,
  overlap,
  status,
  alert,
  readOnly,
  onToggle,
  onPrompt,
  onAccept,
  onRefine,
  onDiscard,
}: {
  enabled: boolean;
  on: boolean;
  prompt: AssistPromptMode;
  busy: boolean;
  canReview: boolean;
  overlap: boolean;
  status: string;
  alert: string;
  readOnly: boolean;
  onToggle: (on: boolean) => void;
  onPrompt: (mode: Exclude<AssistPromptMode, "off">) => void;
  onAccept: () => void;
  onRefine: () => void;
  onDiscard: () => void;
}) {
  if (!enabled) {
    return null;
  }
  return (
    <section aria-label="Assist" aria-busy={busy} className="flex flex-col gap-3">
      <label className="flex min-h-11 items-center gap-2 text-base font-semibold">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={on}
          disabled={readOnly || busy}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Assist
      </label>
      {on ? (
        <>
          <fieldset className="flex flex-wrap gap-3" disabled={readOnly || busy}>
            <legend className="text-sm font-semibold">Assist prompt</legend>
            {PROMPTS.map((item) => (
              <label key={item.id} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="assist-prompt"
                  className="h-5 w-5"
                  value={item.id}
                  checked={prompt === item.id}
                  onChange={() => onPrompt(item.id)}
                />
                {item.label}
              </label>
            ))}
          </fieldset>
          {busy ? <p role="status">Assist is working.</p> : null}
          {status ? <p role="status">{status}</p> : null}
          {alert ? (
            <p role="alert" className="text-base text-accent">
              {alert}
            </p>
          ) : null}
          {overlap ? (
            <p role="status">This draft overlaps a measurement. Accepting keeps both.</p>
          ) : null}
          {canReview ? (
            <div className="flex flex-wrap gap-3">
              <Button type="button" disabled={readOnly || busy} onClick={onAccept}>
                Accept
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={readOnly || busy}
                onClick={onRefine}
              >
                Refine
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={readOnly || busy}
                onClick={onDiscard}
              >
                Discard
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
