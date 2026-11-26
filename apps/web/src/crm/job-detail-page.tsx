import { Button, TextField } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, type KeyboardEvent, useState } from "react";

import { api } from "../session";
import { formatCents, formatWhen, memberName, stageLabel } from "./format";
import { message } from "./messages";
import { SiteMap } from "./site-map";
import { StageMove } from "./stage-move";
import type { ActivityEvent, Job, JobFile, Location, Note, Task } from "./types";
import { takeWarnings } from "./warnings";
import { JobEstimates } from "../estimate/job-estimates";
import { TakeoffsPanel } from "../takeoff/start";
import { useMembers, useWorkspace } from "./workspace";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files and photos" },
  { id: "notes", label: "Notes and tasks" },
  { id: "activity", label: "Activity" },
  { id: "takeoffs", label: "Takeoffs" },
  { id: "estimates", label: "Estimates" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const MAX_BYTES = 50_000_000;

export function JobDetailPage({ jobId }: { jobId: string }) {
  const { workspaceId, currency } = useWorkspace();
  const members = useMembers(workspaceId);
  const client = useQueryClient();
  const [tab, setTab] = useState<TabId>("overview");
  const [warnings] = useState(() => takeWarnings(jobId));
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<Job>(`/jobs/${jobId}`),
    enabled: Boolean(workspaceId),
  });
  const location = useQuery({
    queryKey: ["location", job.data?.location_id],
    queryFn: () => api<Location>(`/locations/${job.data?.location_id}`),
    enabled: Boolean(workspaceId && job.data?.location_id),
  });

  async function onMove(to: string, reason?: string) {
    await api(`/jobs/${jobId}/transition`, {
      method: "POST",
      body: JSON.stringify({ to, ...(reason ? { reason } : {}) }),
    });
    await client.invalidateQueries({ queryKey: ["job", jobId] });
    await client.invalidateQueries({ queryKey: ["jobs"] });
    await client.invalidateQueries({ queryKey: ["pipeline"] });
    await client.invalidateQueries({ queryKey: ["job-activity", jobId] });
  }

  if (!workspaceId || job.isLoading) {
    return <p>Loading job.</p>;
  }
  if (job.isError || !job.data) {
    return (
      <p role="alert" className="text-base text-accent">
        {message(job.error, "That job was not found.")}
      </p>
    );
  }

  const row = job.data;
  const people = members.data?.members ?? [];

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    if (index < 0) {
      return;
    }
    let next: number;
    if (event.key === "ArrowRight") {
      next = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      next = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const button = tabs[next];
    button?.focus();
    button?.click();
  }

  return (
    <div className="flex flex-col gap-6">
      {warnings.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1 text-base text-accent">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      <header className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold">{row.number}</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-semibold">Stage</dt>
            <dd>{stageLabel(row.stage)}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">Client</dt>
            <dd>
              {row.client_id ? (
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: row.client_id }}
                  className="underline"
                >
                  {row.client_name ?? "Client"}
                </Link>
              ) : (
                "No client"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">Site</dt>
            <dd>
              {row.location_id ? (
                <Link
                  to="/locations/$locationId"
                  params={{ locationId: row.location_id }}
                  className="underline"
                >
                  {row.location_line1 ?? "Site"}
                </Link>
              ) : (
                "No site"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">Bid value</dt>
            <dd>
              {row.bid_value_cents === null
                ? "Not set"
                : formatCents(row.bid_value_cents, currency)}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">Owner</dt>
            <dd>{memberName(people, row.owner_member_id)}</dd>
          </div>
        </dl>
        <StageMove jobId={row.id} jobName={row.name} stage={row.stage} onMove={onMove} />
      </header>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line">
        <div
          role="tablist"
          aria-label="Job sections"
          className="flex flex-wrap gap-2"
          onKeyDown={onTabKey}
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-controls={`panel-${item.id}`}
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              className="min-h-11 rounded-md px-3 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-selected:bg-accent aria-selected:text-paper"
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap gap-4 pb-2">
          <li>
            <Link
              to="/jobs/$jobId/takeoffs"
              params={{ jobId }}
              className="text-base font-semibold underline"
            >
              Takeoffs
            </Link>
          </li>
          <li>
            <Link
              to="/jobs/$jobId/estimates"
              params={{ jobId }}
              className="text-base font-semibold underline"
            >
              Estimates
            </Link>
          </li>
          <li>
            <Link to="/proposals" className="text-base font-semibold underline">
              Proposals
            </Link>
          </li>
        </ul>
      </div>
      {tab === "overview" ? (
        <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" tabIndex={0}>
          <Overview job={row} location={location.data ?? null} workspaceId={workspaceId} />
        </div>
      ) : null}
      {tab === "files" ? (
        <div role="tabpanel" id="panel-files" aria-labelledby="tab-files" tabIndex={0}>
          <FilesPanel jobId={jobId} />
        </div>
      ) : null}
      {tab === "notes" ? (
        <div role="tabpanel" id="panel-notes" aria-labelledby="tab-notes" tabIndex={0}>
          <NotesPanel jobId={jobId} />
        </div>
      ) : null}
      {tab === "activity" ? (
        <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" tabIndex={0}>
          <ActivityPanel jobId={jobId} members={people} />
        </div>
      ) : null}
      {tab === "takeoffs" ? (
        <div role="tabpanel" id="panel-takeoffs" aria-labelledby="tab-takeoffs" tabIndex={0}>
          <TakeoffsPanel jobId={jobId} />
        </div>
      ) : null}
      {tab === "estimates" ? (
        <div role="tabpanel" id="panel-estimates" aria-labelledby="tab-estimates" tabIndex={0}>
          <JobEstimates jobId={jobId} />
        </div>
      ) : null}
    </div>
  );
}

function Overview({
  job,
  location,
  workspaceId,
}: {
  job: Job;
  location: Location | null;
  workspaceId: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold">{job.name}</h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold">Tags</dt>
          <dd>{job.tags.length > 0 ? job.tags.join(", ") : "None"}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">Source</dt>
          <dd>{job.source ?? "Not set"}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">Lost reason</dt>
          <dd>{job.lost_reason ?? "None"}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">Updated</dt>
          <dd>{formatWhen(job.updated_at)}</dd>
        </div>
      </dl>
      {location ? (
        <SiteMap
          workspaceId={workspaceId}
          point={location.point}
          parcel={location.site_geom}
          interactive={false}
        />
      ) : (
        <p>No site is linked yet.</p>
      )}
    </div>
  );
}

function FilesPanel({ jobId }: { jobId: string }) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const files = useQuery({
    queryKey: ["job-files", jobId],
    queryFn: () => api<{ files: JobFile[] }>(`/jobs/${jobId}/files`),
  });

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const input = event.currentTarget.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Files must be 50 MB or smaller.");
      return;
    }
    const form = event.currentTarget;
    setBusy(true);
    try {
      const created = await api<{
        upload: { url: string; headers: { "content-type": string } };
      }>(`/jobs/${jobId}/files`, {
        method: "POST",
        body: JSON.stringify({ mime: file.type || "application/octet-stream", bytes: file.size }),
      });
      const put = await fetch(created.upload.url, {
        method: "PUT",
        headers: created.upload.headers,
        body: file,
      });
      if (!put.ok) {
        throw new Error("The file did not upload.");
      }
      form.reset();
      await client.invalidateQueries({ queryKey: ["job-files", jobId] });
    } catch (err) {
      setError(message(err, "Could not upload the file."));
    } finally {
      setBusy(false);
    }
  }

  const rows = files.data?.files ?? [];

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onUpload} className="flex max-w-xl flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="job-file" className="text-sm font-semibold">
            Photo or file
          </label>
          <input id="job-file" name="file" type="file" className="min-h-11 text-base" />
        </div>
        {error ? (
          <p role="alert" className="text-base text-accent">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          Upload file
        </Button>
      </form>
      {files.isLoading ? <p>Loading files.</p> : null}
      {files.isSuccess && rows.length === 0 ? <p>No files yet.</p> : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map((file) => {
          const image = file.mime?.startsWith("image/") && file.download_url;
          return (
            <li key={file.id}>
              <figure className="flex flex-col gap-2 rounded-md border border-line p-3">
                {image ? (
                  <img
                    src={file.download_url}
                    alt="Uploaded photo"
                    className="h-40 w-full rounded-md object-cover"
                  />
                ) : (
                  <p>{file.mime ?? "File"}</p>
                )}
                <figcaption className="text-sm text-muted">
                  {file.status} · {file.bytes ?? "unknown"} bytes · {formatWhen(file.created_at)}
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NotesPanel({ jobId }: { jobId: string }) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const notes = useQuery({
    queryKey: ["job-notes", jobId],
    queryFn: () => api<{ notes: Note[] }>(`/jobs/${jobId}/notes`),
  });
  const tasks = useQuery({
    queryKey: ["job-tasks", jobId],
    queryFn: () => api<{ tasks: Task[] }>(`/jobs/${jobId}/tasks`),
  });

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    try {
      await api(`/jobs/${jobId}/notes`, { method: "POST", body: JSON.stringify({ body }) });
      form.reset();
      await client.invalidateQueries({ queryKey: ["job-notes", jobId] });
    } catch (err) {
      setError(message(err, "Could not save the note."));
    }
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title") ?? "").trim();
    const due = String(new FormData(form).get("due") ?? "");
    try {
      await api(`/jobs/${jobId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title, ...(due ? { due_at: new Date(due).toISOString() } : {}) }),
      });
      form.reset();
      await client.invalidateQueries({ queryKey: ["job-tasks", jobId] });
    } catch (err) {
      setError(message(err, "Could not save the task."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      <section className="flex flex-col gap-3">
        <h3 className="text-xl font-semibold">Notes</h3>
        <form onSubmit={addNote} className="flex max-w-xl flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="note-body" className="text-sm font-semibold">
              Note
            </label>
            <textarea
              id="note-body"
              name="body"
              required
              className="min-h-24 w-full rounded-md border border-line bg-paper px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            />
          </div>
          <Button type="submit">Add note</Button>
        </form>
        {notes.isSuccess && notes.data.notes.length === 0 ? <p>No notes yet.</p> : null}
        <ul className="flex flex-col gap-3">
          {(notes.data?.notes ?? []).map((note) => (
            <li key={note.id} className="rounded-md border border-line p-3">
              <p>{note.body}</p>
              <p className="text-sm text-muted">{formatWhen(note.created_at)}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-xl font-semibold">Tasks</h3>
        <form onSubmit={addTask} className="flex max-w-xl flex-col gap-3">
          <TextField id="task-title" name="title" label="Task" required />
          <TextField id="task-due" name="due" label="Due date" type="date" />
          <Button type="submit">Add task</Button>
        </form>
        {tasks.isSuccess && tasks.data.tasks.length === 0 ? <p>No tasks yet.</p> : null}
        <ul className="flex flex-col gap-2">
          {(tasks.data?.tasks ?? []).map((task) => (
            <li key={task.id}>
              {task.title}
              {task.done ? " (done)" : ""}
              {task.due_at ? ` · due ${formatWhen(task.due_at)}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ActivityPanel({
  jobId,
  members,
}: {
  jobId: string;
  members: { id: string; name: string | null; email: string | null }[];
}) {
  const activity = useQuery({
    queryKey: ["job-activity", jobId],
    queryFn: () => api<{ events: ActivityEvent[] }>(`/jobs/${jobId}/activity`),
  });
  if (activity.isLoading) {
    return <p>Loading activity.</p>;
  }
  if (activity.isError) {
    return (
      <p role="alert" className="text-base text-accent">
        {message(activity.error, "Could not load activity.")}
      </p>
    );
  }
  const events = activity.data?.events ?? [];
  if (events.length === 0) {
    return <p>No activity yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-3">
      {events.map((event) => (
        <li key={event.id} className="rounded-md border border-line p-3">
          <p>
            {stageLabel(event.diff?.from ?? "")} to {stageLabel(event.diff?.to ?? "")}
            {event.diff?.reason ? `. Reason: ${event.diff.reason}` : ""}
            {event.diff?.forced ? " Forced." : ""}
          </p>
          <p className="text-sm text-muted">
            {memberName(members, event.actor_member_id)}
            {event.at ? ` · ${formatWhen(event.at)}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
