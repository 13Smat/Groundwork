# 10 — Crew mobile (offline-first)

Phase: v1. Effort: 6 person-weeks (estimate). Depends on: 09, 02.

## Goal
Crews see today's work, clock in/out, complete checklists, take GPS-tagged photos and submit a daily report — all working with no signal, syncing later without losing or duplicating data.

## Platform decision
Capacitor (wrap a React/Vite crew app) over React Native: reuses Andy's stack, components and zod types; native plugins cover camera, geolocation, filesystem, SQLite, push. The competitor ships a Capacitor shell too (teardown Page). React Native only if background GPS tracking/high-performance maps become core.

## User stories
- As a crew member, I sign in once; the app works offline afterwards for 14 days before re-auth.
- I see today's and tomorrow's jobs with address, scope, notes, site map snapshot (cached), contact.
- I (or the foreman for the whole crew) clock in at a job; GPS point captured; breaks; clock out.
- I complete required checklists (safety at start, closeout at end); items can require a photo or signature.
- I take photos; they're GPS/time-stamped, tagged, queued, and uploaded on Wi-Fi or any connection (setting).
- I submit a daily report: notes, quantities completed per scope item, weather, issues.
- I see sync status (pending items count) and never lose data if the app is killed.

## Screens
Login; Today list; Job detail (scope, map snapshot, notes, navigate button -> native maps); Clock panel (crew/individual modes); Checklist runner; Camera + photo queue; Daily report form; Sync status; Settings (upload on Wi-Fi only).

## Offline architecture
- Local DB: SQLite (`@capacitor-community/sqlite`) with tables mirroring server rows the member can see (scoped by schedule window: -7 to +14 days).
- Down-sync: `GET /sync/pull?since=<cursor>` returns changed rows (schedule entries, work orders, locations, checklists, crews) + tombstones; cursor = server LSN/updated_at+id.
- Up-sync: outbox table of mutations (create time_entry, checklist_run, photo, daily_report; update clock_out) each with `client_uuid`; `POST /sync/push` batch; server upserts idempotently by `client_uuid`; returns per-item result.
- Photos: file written to app storage first; outbox item uploads via presigned URL, then creates Photo row; retries with backoff; resumable for > 5 MB.
- Conflicts: crew-created records are append-only (no conflict). Server-owned records (schedule) are server-wins. Time entries edited in office after sync are locked on device (status approved).
- Clock: store device time + monotonic offset; server records received_at; flag entries where device clock skew > 5 min.
- Alternative: PowerSync (Postgres <-> SQLite sync). Cloud Free $0 (2 GB synced/mo, 50 concurrent clients), Pro from $49/mo, Team from $599/mo; self-hosted Open Edition free (https://powersync.com/pricing, 2026-11-25). Decide at v1 kickoff: custom outbox (above) vs PowerSync.

## API
| Method | Path |
|---|---|
| POST | /auth/crew/code {phone|email} ; POST /auth/crew/verify -> device token |
| GET | /sync/pull?since= |
| POST | /sync/push {mutations[]} |
| POST | /files/presign {mime, bytes, sha256} |
| GET | /me/schedule?from&to (online fallback) |

## Entities
TimeEntry, ChecklistRun, Checklist, Photo, DailyReport, ScheduleEntry, WorkOrder, Crew, File.

## State machines
TimeEntry: `open (clocked in) -> on_break -> open -> closed -> approved | rejected(edit) `. Office edits after approval create an audit entry.
Outbox item: `pending -> sending -> done | failed(retry n) -> dead(after 10, surfaced to user)`.

## Overtime/payroll (v1 minimal)
Daily/weekly OT thresholds configurable per workspace (e.g. after 8 h/day or 40 h/week at 1.5x — user-configured, not hardcoded); CSV payroll export. Payroll provider sync = Later.

## Edge cases
- App killed mid-photo upload -> resumes from outbox on next launch.
- Same member clocked in on two devices -> server rejects second open entry (409), device shows conflict.
- Foreman clocks in crew; one member arrives late -> per-member adjust.
- GPS denied -> allowed with flag; checklist may require location.
- Storage full -> block new photos with message; don't drop queued ones.
- Device date wrong -> skew flag.

## Acceptance criteria
- Airplane-mode e2e (Appium/Detox or Capacitor e2e): clock in, complete checklist with 3 photos, daily report, clock out; relaunch; reconnect -> server has exactly 1 time entry, 1 checklist run, 3 photos, 1 daily report.
- Push of the same batch twice creates no duplicates (test).
- Pull after 3 days offline returns only rows changed since cursor, plus tombstones for unassigned work (test).
- Cold start to Today list < 2 s offline on a mid-range Android (manual perf check).
- Photos keep EXIF time and GPS; server stores geo point (test).

## Out of scope
Background location tracking/live crew map (Later), in-app messaging (Later), equipment inspections (Later), offline takeoff editing.

## Buy vs build
Build on Capacitor (MIT). Sync: build outbox (default) or buy PowerSync (open decision). Push: FCM/APNs via Capacitor Push Notifications.
