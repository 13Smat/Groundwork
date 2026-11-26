# 09 — Scheduling & dispatch

Phase: v1. Effort: 4 person-weeks (estimate). Depends on: 03, 08 (work orders), 02 (crews/members).

## Goal
Put won work on a calendar by crew, publish it to crews, and reshuffle fast for weather.

## User stories
- I see a board of work orders ready to schedule, and a calendar (day/week/month) with crews as rows.
- I drag a work order onto a crew/day; multi-day jobs span days; I set start time and duration.
- I publish the schedule; crews see it on the crew app (10); unpublished changes are drafts.
- A rain day: I select a day and push all entries forward by N working days per crew.
- I see a map of the day's stops per crew and reorder them; travel time shown (v1: straight-line or routing API).
- I see conflicts (crew double-booked, member on two crews, equipment Later).

## Screens
Ops board (columns = WorkOrder status), Schedule (resource timeline day/week, month), Day map (stops per crew), Crew management (members, foreman, color, day rate), Publish bar (n unpublished changes).

## API
| Method | Path |
|---|---|
| GET | /work-orders?status= ; PATCH /work-orders/:id |
| GET/POST | /schedule-entries?from&to&crewId ; PATCH/DELETE /schedule-entries/:id |
| POST | /schedule/publish {from,to} |
| POST | /schedule/shift {date, days, crewIds?} (rain-out) |
| GET | /schedule/day-route?date&crewId -> ordered stops + legs |
| GET/POST | /crews ; PATCH /crews/:id ; PUT /crews/:id/members |

## Entities
WorkOrder, ScheduleEntry, Crew, Member, Location, Job.

## State machines
WorkOrder: `ready -> scheduled -> dispatched (published) -> in_progress (first clock-in) -> done (daily report marks complete) | cancelled`.
ScheduleEntry: `tentative -> published -> done | rained_out` (rained_out spawns a new tentative entry when shifted).

## Edge cases
- Shift crosses weekends/holidays -> workspace working-days calendar.
- Multi-day entry partially rained out -> split entry.
- Timezone: all times stored UTC, rendered in workspace TZ; DST boundaries tested.
- Crew app offline when schedule changes -> next sync pulls; published-change push notification.
- Two dispatchers editing same entry -> optimistic concurrency (`updated_at` precondition, 409).

## Acceptance criteria
- Drag-to-schedule creates a tentative entry and moves the work order to `scheduled` (e2e).
- Publish makes entries visible to the assigned crew's members via sync API and not before (test).
- Shift by 1 working day on a Friday moves entries to Monday, skipping configured holidays (unit test).
- Conflict detection flags double booking (unit test).
- DST: an 07:00 entry on the DST change day renders 07:00 local (test).

## Out of scope
Auto-optimized routing/balancing (Later), equipment/fleet scheduling (Later), customer appointment booking (Later), service-contract recurrences (Later).

## Buy vs build
Build the data/logic. UI: FullCalendar (MIT core; resource timeline views are a paid premium tier — price not checked) or build a resource timeline with a virtualized grid. Routing: Google Routes API or self-hosted OSRM/Valhalla (not priced here) — v1 can ship with straight-line ordering.
