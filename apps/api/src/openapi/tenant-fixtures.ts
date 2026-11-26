import type { Fixture } from "./sweep.js";

/**
 * Every tenant-tagged operation. `foreign` calls are made as workspace A
 * against a workspace B id and must return 404. `caller-scoped` routes do
 * not take another workspace's id; they are listed so a new route cannot
 * be skipped. ADR 0023.
 */
const scoped = (reason: string): Fixture => ({ kind: "caller-scoped", reason });

const foreign = (
  params: Record<string, string> = {},
  extra: { query?: Record<string, string>; body?: unknown } = {},
): Fixture => ({
  kind: "foreign",
  ...(Object.keys(params).length > 0 ? { params } : {}),
  ...extra,
});

const id = (name: string): Record<string, string> => ({ id: `{{${name}}}` });

export const TENANT_FIXTURES: Record<string, Fixture> = {
  "get /workspaces/{id}": foreign(id("workspace")),
  "patch /workspaces/{id}": foreign(id("workspace"), { body: { name: "Nope" } }),
  "post /workspaces/{id}/activate": foreign(id("workspace")),
  "get /workspaces/{id}/members": foreign(id("workspace")),
  "post /workspaces/{id}/invites": foreign(id("workspace"), {
    body: { email: "nobody@example.com", roleId: "{{role}}" },
  }),
  "patch /members/{id}": foreign(id("member"), { body: { status: "disabled" } }),

  "get /catalog-items": scoped("Lists the caller's catalog."),
  "post /catalog-items": scoped("Creates a catalog row in the caller's workspace."),
  "patch /catalog-items/{id}": foreign(id("catalogItem"), { body: { name: "Nope" } }),
  "delete /catalog-items/{id}": foreign(id("catalogItem")),
  "post /catalog-items/import": scoped("Imports CSV into the caller's catalog."),
  "get /catalog-items/export": scoped("Exports the caller's catalog."),
  "post /catalog-items/starter-pack": scoped("Loads the starter pack into the caller's workspace."),
  "get /takeoff-items": scoped("Lists the caller's takeoff items."),
  "post /takeoff-items": scoped("Creates a takeoff item in the caller's workspace."),
  "patch /takeoff-items/{id}": foreign(id("takeoffItem"), { body: { name: "Nope" } }),
  "get /cost-recipes": scoped("Lists the caller's recipes."),
  "post /cost-recipes": scoped("Creates a recipe in the caller's workspace."),
  "get /cost-recipes/{id}": foreign(id("recipe")),
  "patch /cost-recipes/{id}": foreign(id("recipe"), { body: { name: "Nope" } }),
  "post /cost-recipes/{id}/versions": foreign(id("recipe"), { body: {} }),
  "post /cost-recipes/{id}/preview": foreign(id("recipe"), {
    body: { input_qty: "1", input_unit: "ft2" },
  }),
  "post /formula/validate": scoped("Validates a formula. It does not read a tenant row."),

  "get /admin/imagery-sources": scoped("Lists sources visible to the caller's workspace."),
  "post /admin/imagery-sources": scoped("Creates a source in the caller's workspace."),
  "patch /admin/imagery-sources/{sourceId}": foreign(
    { sourceId: "{{imagerySource}}" },
    { body: { notes: "Nope" } },
  ),
  "get /imagery/captures": foreign({}, { query: { locationId: "{{location}}" } }),
  "get /imagery/tiles/{captureId}/{z}/{x}/{y}": foreign({
    captureId: "{{capture}}",
    z: "1",
    x: "0",
    y: "0",
  }),
  "post /imagery/ingest": foreign(
    {},
    { body: { sourceId: "{{imagerySource}}", year: 2024, countyFips: "37023" } },
  ),
  "get /imagery/ingest/{jobId}": foreign({ jobId: "{{ingestJob}}" }),

  "get /clients": scoped("Lists the caller's clients."),
  "post /clients": scoped("Creates a client in the caller's workspace."),
  "get /clients/{id}": foreign(id("client")),
  "patch /clients/{id}": foreign(id("client"), { body: { name: "Hidden" } }),
  "delete /clients/{id}": foreign(id("client")),
  "get /clients/{id}/contacts": foreign(id("client")),
  "post /clients/{id}/contacts": foreign(id("client"), { body: { name: "Hidden" } }),
  "patch /contacts/{id}": foreign(id("contact"), { body: { name: "Hidden" } }),
  "delete /contacts/{id}": foreign(id("contact")),
  "get /locations": scoped("Lists the caller's locations."),
  "post /locations": foreign(
    {},
    { body: { client_id: "{{client}}", address: { line1: "1 Main St" } } },
  ),
  "get /locations/{id}": foreign(id("location")),
  "get /locations/{id}/parcels": foreign(id("location"), {
    query: { bbox: "-81.95,35.52,-81.40,35.99" },
  }),
  "patch /locations/{id}": foreign(id("location"), { body: { notes: "no" } }),
  "post /locations/resolve": scoped("Resolves an address in the caller's workspace."),
  "get /jobs": scoped("Lists the caller's jobs."),
  "post /jobs": scoped("Creates a job in the caller's workspace."),
  "get /jobs/{id}": foreign(id("job")),
  "patch /jobs/{id}": foreign(id("job"), { body: { name: "Hidden" } }),
  "post /jobs/{id}/transition": foreign(id("job"), { body: { to: "lost", reason: "price" } }),
  "get /jobs/{id}/notes": foreign(id("job")),
  "post /jobs/{id}/notes": foreign(id("job"), { body: { body: "note" } }),
  "get /jobs/{id}/tasks": foreign(id("job")),
  "post /jobs/{id}/tasks": foreign(id("job"), { body: { title: "task" } }),
  "get /jobs/{id}/files": foreign(id("job")),
  "post /jobs/{id}/files": foreign(id("job"), { body: { mime: "image/png" } }),
  "get /jobs/{id}/activity": foreign(id("job")),
  "get /search": scoped("Searches the caller's workspace."),
  "get /pipeline/summary": scoped("Summarizes the caller's pipeline."),

  "post /jobs/{id}/takeoffs": foreign(id("job"), { body: { kind: "planset" } }),
  "get /jobs/{id}/takeoffs": foreign(id("job")),
  "get /takeoffs/{id}": foreign(id("takeoff")),
  "patch /takeoffs/{id}": foreign(id("takeoff"), { body: { status: "in_review" } }),
  "get /takeoffs/{id}/measurements": foreign(id("takeoff")),
  "put /takeoffs/{id}/measurements": foreign(id("takeoff"), { body: { features: [] } }),
  "delete /measurements/{id}": foreign(id("measurement")),
  "post /takeoffs/{id}/assist": foreign(id("takeoff"), {
    body: {
      imagery_capture_id: "{{capture}}",
      takeoff_item_id: "{{takeoffItem}}",
      points: [{ lng: -81.7, lat: 35.75, label: 1 }],
    },
  }),
  "get /detections/{id}": foreign(id("detection")),
  "post /detections/{id}/accept": foreign(id("detection"), { body: { all: true } }),
  "post /detections/{id}/reject": foreign(id("detection"), { body: { all: true } }),
  "get /takeoffs/{id}/export": foreign(id("takeoff")),
  "get /takeoffs/{id}/measurements/tiles/{z}/{x}/{y}": foreign({
    id: "{{takeoff}}",
    z: "1",
    x: "0",
    y: "0",
  }),
  "get /takeoffs/{id}/summary": foreign(id("takeoff")),

  "post /jobs/{id}/estimates": foreign(id("job"), { body: {} }),
  "get /jobs/{id}/estimates": foreign(id("job")),
  "get /estimates/{id}": foreign(id("estimate")),
  "patch /estimates/{id}": foreign(id("estimate"), { body: { notes: "no" } }),
  "post /estimates/{id}/lines": foreign(id("estimate"), {
    body: { description: "Nope", qty: "1", unit: "ea" },
  }),
  "patch /line-items/{id}": foreign(id("lineItem"), { body: { description: "Nope" } }),
  "delete /line-items/{id}": foreign(id("lineItem")),
  "post /estimates/{id}/recalculate": foreign(id("estimate"), { body: {} }),
  "post /estimates/{id}/transition": foreign(id("estimate"), { body: { to: "ready" } }),
  "get /estimates/{id}/quantity-diff": foreign(id("estimate")),
  "post /estimates/{id}/apply-quantities": foreign(id("estimate"), { body: {} }),
  "post /estimates/{id}/versions": foreign(id("estimate"), { body: {} }),

  "post /estimates/{id}/proposals": foreign(id("estimate"), { body: {} }),
  "get /estimates/{id}/proposals": foreign(id("estimate")),
  "get /jobs/{id}/proposals": foreign(id("job")),
  "get /proposals/{id}": foreign(id("proposal")),
  "patch /proposals/{id}": foreign(id("proposal"), { body: { intro: "no" } }),
  "post /proposals/{id}/render": foreign(id("proposal"), { body: {} }),
  "get /proposals/{id}/pdf": foreign(id("proposal")),
  "get /proposal-templates": scoped("Lists the caller's proposal templates."),
  "post /proposal-templates": scoped("Creates a template in the caller's workspace."),
  "patch /proposal-templates/{id}": foreign(id("proposalTemplate"), { body: { name: "Nope" } }),
  "post /proposals/{id}/link": foreign(id("proposal"), { body: {} }),
  "post /proposals/{id}/send": foreign(id("proposal"), {
    body: { recipients: [{ name: "Nope", email: "nope@example.com" }] },
  }),
  "post /proposals/{id}/void": foreign(id("proposal"), { body: {} }),
};
