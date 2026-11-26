import type { GeoJsonPolygon } from "@groundwork/geo";
import { createId } from "@groundwork/shared";
import { Button, Dialog, DialogContent, SelectField } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { message } from "../crm/messages";
import type { Location } from "../crm/types";
import { useWorkspace } from "../crm/workspace";
import { api } from "../session";
import { AssistPanel } from "./assist-panel";
import { downloadTakeoff } from "./download";
import { cutHole, holeTarget, mergeAreas, splitMeasurement } from "./edit-geometry";
import type { DrawApi, SketchEvent } from "./editor-map";
import { TakeoffMap } from "./editor-map";
import { emptyHistory, pushHistory, redoHistory, snapshotCommand, undoHistory } from "./history";
import { allowedCaptures, captureOptionLabel } from "./imagery";
import { ImageryNotice } from "./notice";
import { FeaturePanel, ItemPanel, MeasurementWarnings, SummaryDrawer, ToolBar } from "./panels";
import type { ParcelHit } from "./parcels";
import { ParcelSelect } from "./parcels";
import {
  applyServer,
  editorFeaturesFrom,
  itemColor,
  kindForMode,
  measurementGeometry,
  mergeCommit,
  toLoadFeatures,
} from "./quantities";
import { DIRECT_FEATURE_LIMIT } from "./render-budget";
import { useAssist } from "./use-assist";
import type {
  CommitFeature,
  DrawTool,
  EditorFeature,
  ImageryCapture,
  MeasurementCollection,
  SummaryItem,
  TakeoffItemRow,
  TakeoffRecord,
} from "./types";

export default function TakeoffEditorPage({
  jobId,
  takeoffId,
}: {
  jobId: string;
  takeoffId: string;
}) {
  const { workspaceId, aiAssist } = useWorkspace();
  const client = useQueryClient();
  const takeoff = useQuery({
    queryKey: ["takeoff", takeoffId],
    queryFn: () => api<TakeoffRecord>(`/takeoffs/${takeoffId}`),
    enabled: Boolean(workspaceId),
  });
  const locationId = takeoff.data?.location_id ?? undefined;
  const location = useQuery({
    queryKey: ["location", locationId],
    queryFn: () => api<Location>(`/locations/${locationId}`),
    enabled: Boolean(workspaceId && locationId),
  });
  const captures = useQuery({
    queryKey: ["imagery-captures", locationId],
    queryFn: () =>
      api<{ captures: ImageryCapture[] }>(`/imagery/captures?locationId=${locationId}`),
    enabled: Boolean(workspaceId && locationId && location.data?.point),
  });
  const items = useQuery({
    queryKey: ["takeoff-items"],
    queryFn: () => api<{ items: TakeoffItemRow[] }>("/takeoff-items"),
    enabled: Boolean(workspaceId),
  });
  const measurements = useQuery({
    queryKey: ["measurements", takeoffId],
    queryFn: () => api<MeasurementCollection>(`/takeoffs/${takeoffId}/measurements`),
    enabled: Boolean(workspaceId),
  });
  const summary = useQuery({
    queryKey: ["takeoff-summary", takeoffId],
    queryFn: () => api<{ items: SummaryItem[] }>(`/takeoffs/${takeoffId}/summary`),
    enabled: Boolean(workspaceId),
  });

  const [features, setFeatures] = useState<EditorFeature[] | null>(null);
  const [tool, setTool] = useState<DrawTool>("select");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [hiddenItemIds, setHiddenItemIds] = useState<ReadonlySet<string>>(() => new Set());
  const [live, setLive] = useState<string | null>(null);
  const [ruler, setRuler] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<string | null>(null);
  const [switchWarnings, setSwitchWarnings] = useState<string[]>([]);
  const [switching, setSwitching] = useState(false);
  const [snap, setSnap] = useState(false);
  const [history, setHistory] = useState(emptyHistory);
  const [savedNotices, setSavedNotices] = useState<{
    corrections: number;
    overlaps: number;
  } | null>(null);
  const [persistedIds, setPersistedIds] = useState<ReadonlySet<string>>(() => new Set());
  const apiRef = useRef<DrawApi | null>(null);
  const featuresRef = useRef<EditorFeature[] | null>(null);
  const itemsRef = useRef<TakeoffItemRow[]>([]);
  const toolRef = useRef(tool);
  const pendingLoad = useRef<ReturnType<typeof editorFeaturesFrom>["load"] | null>(null);
  const pendingSelect = useRef<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  useEffect(() => {
    featuresRef.current = features;
  }, [features]);

  useEffect(() => {
    itemsRef.current = items.data?.items.filter((item) => item.archived_at === null) ?? [];
  }, [items.data]);

  useEffect(() => {
    if (seeded.current || !measurements.isSuccess || !items.isSuccess) {
      return;
    }
    seeded.current = true;
    const built = editorFeaturesFrom(measurements.data, items.data.items);
    pendingLoad.current = built.load;
    featuresRef.current = built.features;
    setFeatures(built.features);
    setPersistedIds(
      new Set(built.features.filter((feature) => feature.server).map((feature) => feature.id)),
    );
  }, [items.data, items.isSuccess, measurements.data, measurements.isSuccess]);

  useEffect(() => {
    const api = apiRef.current;
    const load = pendingLoad.current;
    if (!api || !load) {
      return;
    }
    api.load(load);
    pendingLoad.current = null;
    const select = pendingSelect.current;
    if (select) {
      pendingSelect.current = null;
      api.selectFeature(select);
    }
  }, [features, mapReady]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) {
      return;
    }
    api.setMode(tool);
    if (tool === "select" && pendingSelect.current) {
      const id = pendingSelect.current;
      pendingSelect.current = null;
      api.selectFeature(id);
    }
  }, [tool, mapReady]);

  useEffect(() => {
    apiRef.current?.setSnap(snap);
  }, [snap, mapReady]);

  const catalog = items.data?.items.filter((item) => item.archived_at === null) ?? [];
  const selectedItem = catalog.find((item) => item.id === selectedItemId) ?? null;
  const activeItem = selectedItem
    ? {
        id: selectedItem.id,
        kind: selectedItem.measure_kind,
        color: itemColor(selectedItem.color, catalog.indexOf(selectedItem)),
      }
    : null;
  const selectedFeature = features?.find((feature) => feature.id === selectedFeatureId) ?? null;
  const selectedFeatureItem = catalog.find((item) => item.id === selectedFeature?.itemId) ?? null;
  const allowed = captures.data ? allowedCaptures(captures.data.captures) : [];
  const currentCapture =
    allowed.find((capture) => capture.id === takeoff.data?.imagery_capture_id) ?? null;
  const readOnly = takeoff.data?.status === "final";
  const areaChoice =
    (selectedItem?.measure_kind === "area" ? selectedItem : null) ??
    catalog.find((item) => item.measure_kind === "area") ??
    null;
  const areaItem = areaChoice
    ? { id: areaChoice.id, color: itemColor(areaChoice.color, catalog.indexOf(areaChoice)) }
    : null;
  const assist = useAssist({
    enabled: aiAssist,
    readOnly,
    takeoffId,
    captureId: takeoff.data?.imagery_capture_id ?? null,
    areaItem,
    measurements: features ?? [],
    onAccepted(accepted) {
      const built = editorFeaturesFrom(
        { type: "FeatureCollection", features: accepted, corrections: [], overlaps: [] },
        catalog,
      );
      const base = featuresRef.current ?? [];
      const ids = new Set(base.map((feature) => feature.id));
      const next = [...base, ...built.features.filter((feature) => !ids.has(feature.id))];
      featuresRef.current = next;
      pendingLoad.current = toLoadFeatures(next, catalog);
      setFeatures(next);
      setPersistedIds((current) => {
        const ids = new Set(current);
        for (const feature of next) {
          if (feature.server) {
            ids.add(feature.id);
          }
        }
        return ids;
      });
      const first = built.features[0];
      if (first) {
        pendingSelect.current = first.id;
        setSelectedFeatureId(first.id);
      }
      setTool("select");
      setSaveStatus("");
      void client.invalidateQueries({ queryKey: ["takeoff-summary", takeoffId] });
      void client.invalidateQueries({ queryKey: ["takeoff", takeoffId] });
    },
  });

  function onReady(api: DrawApi) {
    apiRef.current = api;
    setMapReady(true);
    api.setMode(toolRef.current);
    const load = pendingLoad.current;
    if (load) {
      api.load(load);
      pendingLoad.current = null;
    }
    const select = pendingSelect.current;
    if (select) {
      pendingSelect.current = null;
      api.selectFeature(select);
    }
  }

  function remember(before: EditorFeature[], after: EditorFeature[]) {
    const command = snapshotCommand(before, after, Date.now());
    if (!command) {
      return;
    }
    setHistory((current) => pushHistory(current, command));
  }

  function showFeatures(next: EditorFeature[]) {
    featuresRef.current = next;
    setFeatures(next);
    apiRef.current?.load(toLoadFeatures(next, itemsRef.current));
  }

  function onCommit(commit: CommitFeature[]) {
    const current = featuresRef.current;
    if (!current) {
      return;
    }
    const next = mergeCommit(current, commit);
    remember(current, next);
    featuresRef.current = next;
    setFeatures(next);
    setSaveStatus("");
  }

  function onUndo() {
    const step = undoHistory(history);
    if (!step) {
      return;
    }
    setHistory(step.history);
    showFeatures(step.features);
    setSelectedFeatureId(null);
  }

  function onRedo() {
    const step = redoHistory(history);
    if (!step) {
      return;
    }
    setHistory(step.history);
    showFeatures(step.features);
    setSelectedFeatureId(null);
  }

  function onSketch(event: SketchEvent) {
    const current = featuresRef.current;
    if (!current || takeoff.data?.status === "final") {
      return;
    }
    if (event.intent === "hole" && event.geometry.type === "Polygon") {
      const target = holeTarget(current, selectedFeatureId, event.geometry);
      if (!target || target.geometry.type !== "Polygon") {
        setError("Draw the hole inside an area.");
        return;
      }
      const cut = cutHole(target.geometry, event.geometry);
      if (!cut) {
        setError("That hole must sit inside the area without crossing its outline.");
        return;
      }
      const next = current.map((feature) =>
        feature.id === target.id
          ? { ...feature, geometry: cut, server: null, measuredKey: null }
          : feature,
      );
      remember(current, next);
      featuresRef.current = next;
      setFeatures(next);
      apiRef.current?.replaceGeometry(target.id, cut);
      setError("");
      return;
    }
    const selected = current.find((feature) => feature.id === selectedFeatureId);
    if (!selected) {
      setError("Select a measurement to split.");
      return;
    }
    const parts = splitMeasurement(selected.geometry, event.geometry);
    const first = parts?.[0];
    const second = parts?.[1];
    if (!first || !second) {
      setError("The split line must cross that measurement.");
      return;
    }
    const next = current.flatMap((feature) => {
      if (feature.id !== selected.id) {
        return [feature];
      }
      return [
        { ...feature, geometry: first, server: null, measuredKey: null },
        { ...feature, id: createId(), geometry: second, server: null, measuredKey: null },
      ];
    });
    remember(current, next);
    showFeatures(next);
    setError("");
  }

  function onRetag(id: string, itemId: string) {
    const feature = featuresRef.current?.find((row) => row.id === id);
    const item = itemsRef.current.find((row) => row.id === itemId);
    if (!feature || !item || item.measure_kind !== feature.kind) {
      setError("That takeoff item measures a different kind.");
      return;
    }
    apiRef.current?.setItem(id, {
      itemId,
      color: itemColor(item.color, itemsRef.current.indexOf(item)),
      kind: feature.kind,
    });
    setError("");
  }

  function onMerge() {
    const current = featuresRef.current;
    const selected = current?.find((feature) => feature.id === selectedFeatureId);
    if (!current || !selected || selected.geometry.type !== "Polygon") {
      setError("Select an area to merge.");
      return;
    }
    const other = current.find(
      (feature) =>
        feature.id !== selected.id &&
        feature.itemId === selected.itemId &&
        feature.geometry.type === "Polygon",
    );
    if (!other || other.geometry.type !== "Polygon") {
      setError("Choose two areas of the same takeoff item to merge.");
      return;
    }
    const merged = mergeAreas(selected.geometry, other.geometry as GeoJsonPolygon);
    if (!merged) {
      setError("Those areas do not touch, so they stay separate.");
      return;
    }
    const next = current
      .filter((feature) => feature.id !== other.id)
      .map((feature) =>
        feature.id === selected.id
          ? { ...feature, geometry: merged, server: null, measuredKey: null }
          : feature,
      );
    remember(current, next);
    showFeatures(next);
    setError("");
  }

  const onParcels = useCallback((rows: readonly { hit: ParcelHit; selected: boolean }[]) => {
    apiRef.current?.setParcels(
      rows.map((row) => ({ id: row.hit.id, selected: row.selected, geometry: row.hit.geom })),
    );
  }, []);

  function chooseTool(next: DrawTool) {
    setError("");
    if ((featuresRef.current?.length ?? 0) > DIRECT_FEATURE_LIMIT && next !== "select") {
      setError("This takeoff has more than 2,000 measurements. Editing stays paused.");
      return;
    }
    if (next === "polygon" || next === "linestring" || next === "point") {
      const kind = kindForMode(next);
      if (!selectedItem || selectedItem.measure_kind !== kind) {
        const match = catalog.find((item) => item.measure_kind === kind);
        if (!match) {
          setError(`Add a ${kind} takeoff item before using that tool.`);
          return;
        }
        setSelectedItemId(match.id);
      }
    }
    if (next !== "ruler") {
      setRuler(null);
    }
    if (next !== "select") {
      assist.setPrompt("off");
    }
    setTool(next);
    apiRef.current?.setMode(next);
  }

  function onSnapChange(enabled: boolean) {
    setSnap(enabled);
    apiRef.current?.setSnap(enabled);
  }

  function onAssistPrompt(mode: "positive" | "negative" | "box") {
    chooseTool("select");
    assist.setPrompt(mode);
  }

  function onSelectItem(id: string) {
    setSelectedItemId(id);
    apiRef.current?.highlight(id);
    const first = features?.find((feature) => feature.itemId === id);
    if (!first) {
      return;
    }
    setSelectedFeatureId(first.id);
    if (tool === "select") {
      apiRef.current?.selectFeature(first.id);
      return;
    }
    pendingSelect.current = first.id;
    setTool("select");
  }

  function onToggle(id: string, hidden: boolean) {
    setHiddenItemIds((current) => {
      const next = new Set(current);
      if (hidden) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    apiRef.current?.setHidden(id, hidden);
  }

  function onLabel(id: string, label: string) {
    const next = label.trim() === "" ? null : label.slice(0, 200);
    setFeatures((current) =>
      current === null
        ? current
        : current.map((feature) => (feature.id === id ? { ...feature, label: next } : feature)),
    );
    apiRef.current?.setLabel(id, next);
  }

  function onDelete(id: string) {
    const feature = featuresRef.current?.find((row) => row.id === id);
    if (!feature) {
      return;
    }
    setError("");
    apiRef.current?.remove(id);
    setSelectedFeatureId((current) => (current === id ? null : current));
    setSaveStatus("");
  }

  async function onSave() {
    const current = featuresRef.current;
    if (!current || saving) {
      return;
    }
    const removed = [...persistedIds].filter((id) => !current.some((feature) => feature.id === id));
    if (current.length === 0 && removed.length === 0) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const kept = new Set(persistedIds);
      for (const id of removed) {
        await api(`/measurements/${id}`, { method: "DELETE" });
        kept.delete(id);
      }
      setPersistedIds(new Set(kept));
      if (current.length > 0) {
        const collection = await api<MeasurementCollection>(`/takeoffs/${takeoffId}/measurements`, {
          method: "PUT",
          body: JSON.stringify({
            features: current.map((feature) => ({
              id: feature.id,
              takeoff_item_id: feature.itemId,
              kind: feature.kind,
              geom: measurementGeometry(feature.geometry),
              source: feature.source,
              label: feature.label,
            })),
          }),
        });
        const applied = applyServer(current, collection);
        setSavedNotices({
          corrections: collection.corrections.length,
          overlaps: collection.overlaps.length,
        });
        featuresRef.current = applied.features;
        setFeatures(applied.features);
        setPersistedIds(new Set(applied.features.map((feature) => feature.id)));
        for (const feature of applied.replaced) {
          apiRef.current?.replaceGeometry(feature.id, feature.geometry);
        }
      }
      await client.invalidateQueries({ queryKey: ["takeoff-summary", takeoffId] });
      await client.invalidateQueries({ queryKey: ["takeoff", takeoffId] });
      setSaveStatus("Saved. Server totals are ready.");
    } catch (err) {
      setError(message(err, "Could not save measurements."));
      setSaveStatus("");
    } finally {
      setSaving(false);
    }
  }

  async function patchCapture(captureId: string) {
    setSwitching(true);
    setError("");
    try {
      const updated = await api<TakeoffRecord>(`/takeoffs/${takeoffId}`, {
        method: "PATCH",
        body: JSON.stringify({ imagery_capture_id: captureId, confirm: true }),
      });
      client.setQueryData(["takeoff", takeoffId], updated);
      setSwitchWarnings(updated.warnings);
      setPendingCapture(null);
    } catch (err) {
      setError(message(err, "Could not switch the imagery capture."));
    } finally {
      setSwitching(false);
    }
  }

  function onCaptureChange(captureId: string) {
    const current = takeoff.data?.imagery_capture_id;
    if (!captureId || captureId === current) {
      return;
    }
    const hasMeasurements =
      (features?.length ?? 0) > 0 || (takeoff.data?.measurement_count ?? 0) > 0;
    if (hasMeasurements) {
      setPendingCapture(captureId);
      return;
    }
    void patchCapture(captureId);
  }

  if (!workspaceId || takeoff.isLoading || items.isLoading || measurements.isLoading) {
    return <p>Loading the takeoff editor.</p>;
  }
  if (takeoff.isError || !takeoff.data) {
    return (
      <p role="alert" className="text-base text-accent">
        {message(takeoff.error, "That takeoff was not found.")}
      </p>
    );
  }
  if (items.isError) {
    return (
      <p role="alert" className="text-base text-accent">
        {message(items.error, "Could not load takeoff items.")}
      </p>
    );
  }
  if (measurements.isError) {
    return (
      <p role="alert" className="text-base text-accent">
        {message(measurements.error, "Could not load measurements.")}
      </p>
    );
  }
  const sitePending = Boolean(takeoff.data.location_id) && location.isLoading;
  const capturePending = Boolean(location.data?.point) && captures.isLoading;
  if (features === null || !takeoff.data.imagery_capture_id || sitePending || capturePending) {
    return <p>Loading the takeoff editor.</p>;
  }

  const captureId = takeoff.data.imagery_capture_id;
  const pendingDeletes = [...persistedIds].filter(
    (id) => !features.some((feature) => feature.id === id),
  );
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const corrections = savedNotices?.corrections ?? measurements.data?.corrections.length ?? 0;
  const overlaps = savedNotices?.overlaps ?? measurements.data?.overlaps.length ?? 0;
  const throttled = features.length > DIRECT_FEATURE_LIMIT;
  const canMerge = features.some(
    (feature) =>
      feature.id !== selectedFeatureId &&
      feature.itemId === selectedFeature?.itemId &&
      feature.geometry.type === "Polygon" &&
      selectedFeature?.geometry.type === "Polygon",
  );

  return (
    <div className="flex flex-col gap-4">
      <p>
        <Link to="/jobs/$jobId" params={{ jobId }} className="text-base font-semibold underline">
          Back to job
        </Link>
      </p>
      {readOnly ? <p role="status">This takeoff is final. Measuring stays locked.</p> : null}
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_18rem]">
        <ItemPanel
          items={catalog}
          features={features}
          summary={summary.data?.items ?? []}
          selectedItemId={selectedItemId}
          hiddenItemIds={hiddenItemIds}
          onSelectItem={onSelectItem}
          onToggle={onToggle}
        />
        <div className="flex min-w-0 flex-col gap-3">
          <SelectField
            id="imagery-capture"
            label="Imagery capture"
            value={captureId}
            disabled={readOnly || switching || allowed.length === 0}
            onChange={(event) => onCaptureChange(event.target.value)}
          >
            {allowed.map((capture) => (
              <option key={capture.id} value={capture.id}>
                {captureOptionLabel(capture)}
              </option>
            ))}
          </SelectField>
          {currentCapture ? (
            <ImageryNotice capture={currentCapture} extraWarnings={switchWarnings} />
          ) : null}
          {captures.isError ? (
            <p role="alert" className="text-base text-accent">
              {message(captures.error, "Could not load imagery for this site.")}
            </p>
          ) : null}
          <ToolBar
            tool={tool}
            readOnly={readOnly || throttled}
            canFinish={mapReady && tool !== "select"}
            snap={snap}
            canUndo={canUndo}
            canRedo={canRedo}
            onTool={chooseTool}
            onFinish={() => apiRef.current?.finish()}
            onSnap={onSnapChange}
            onUndo={onUndo}
            onRedo={onRedo}
          />
          <p className="text-base">
            {selectedItem
              ? `Drawing ${selectedItem.name}.`
              : "Choose a polygon, line, or point tool to pick a takeoff item."}
          </p>
          <p className="max-w-prose text-base leading-relaxed">
            Choose a tool, draw on the map, and press Finish shape or Enter. Hole cuts an island out
            of the selected area. Split crosses a selected measurement. The ruler is not saved.
          </p>
          {throttled ? (
            <p role="status">
              More than 2,000 measurements. The map shows a simplified overlay and editing is
              paused.
            </p>
          ) : null}
          <MeasurementWarnings corrections={corrections} overlaps={overlaps} />
          <p className="text-sm text-muted">
            The parcel outline is a reference. Measurements are not clipped to it.
          </p>
          <AssistPanel
            enabled={aiAssist}
            on={assist.on}
            prompt={assist.prompt}
            busy={assist.busy}
            canReview={assist.canReview}
            overlap={assist.overlap}
            status={assist.status}
            alert={assist.alert}
            readOnly={readOnly}
            onToggle={(checked) => {
              if (checked) {
                chooseTool("select");
              }
              assist.setEnabled(checked);
            }}
            onPrompt={onAssistPrompt}
            onAccept={() => {
              void assist.accept();
            }}
            onRefine={assist.refine}
            onDiscard={() => {
              void assist.discard();
            }}
          />
          {workspaceId ? (
            <TakeoffMap
              workspaceId={workspaceId}
              captureId={captureId}
              point={location.data?.point ?? null}
              parcel={location.data?.site_geom ?? null}
              activeItem={activeItem}
              hiddenItemIds={hiddenItemIds}
              assistMode={aiAssist ? assist.prompt : "off"}
              assistDrafts={aiAssist ? assist.drafts : undefined}
              onAssistPoint={assist.onPoint}
              onAssistBox={assist.onBox}
              onReady={onReady}
              onCommit={onCommit}
              onSelect={setSelectedFeatureId}
              onLive={setLive}
              onRuler={setRuler}
              onReject={setError}
              onSketch={onSketch}
            />
          ) : null}
          {takeoff.data.location_id ? (
            <ParcelSelect
              locationId={takeoff.data.location_id}
              point={location.data?.point ?? null}
              onChange={onParcels}
            />
          ) : null}
          <p role="status">
            {live ? `Drawing ${live}` : "Draw on the map to see a live quantity."}
          </p>
          {ruler ? <p role="status">Ruler {ruler}. Not saved.</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={
                readOnly || saving || (features.length === 0 && pendingDeletes.length === 0)
              }
              onClick={() => {
                void onSave();
              }}
            >
              {saving ? "Saving measurements" : "Save measurements"}
            </Button>
            <SummaryDrawer items={summary.data?.items ?? []} />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void downloadTakeoff(takeoffId, "geojson").catch((err: unknown) => {
                  setError(message(err, "Could not export GeoJSON."));
                });
              }}
            >
              Export GeoJSON
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void downloadTakeoff(takeoffId, "png").catch((err: unknown) => {
                  setError(message(err, "Could not export the site map."));
                });
              }}
            >
              Export PNG
            </Button>
          </div>
          {saveStatus ? (
            <p role="status" aria-label="Save result">
              {saveStatus}
            </p>
          ) : null}
        </div>
        <FeaturePanel
          feature={selectedFeature}
          itemName={selectedFeatureItem?.name ?? null}
          items={catalog}
          readOnly={readOnly}
          canMerge={canMerge}
          onLabel={onLabel}
          onDelete={(id) => {
            void onDelete(id);
          }}
          onRetag={onRetag}
          onMerge={onMerge}
        />
      </div>
      <Dialog
        open={pendingCapture !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCapture(null);
          }
        }}
      >
        <DialogContent
          title="Switch imagery?"
          description="Measurements stay in geographic coordinates. Confirm before the takeoff uses the other capture."
          initialFocusId="keep-capture"
        >
          <div className="flex flex-wrap gap-3">
            <Button
              id="keep-capture"
              type="button"
              variant="secondary"
              onClick={() => setPendingCapture(null)}
            >
              Keep this capture
            </Button>
            <Button
              type="button"
              disabled={switching || pendingCapture === null}
              onClick={() => {
                if (pendingCapture) {
                  void patchCapture(pendingCapture);
                }
              }}
            >
              {switching ? "Switching capture" : "Switch capture"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
