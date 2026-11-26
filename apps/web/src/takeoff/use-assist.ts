import { createId } from "@groundwork/shared";
import type { GeoJsonGeometry } from "@groundwork/geo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { message } from "../crm/messages";
import { api } from "../session";
import { polygonOverlaps } from "./assist-geometry";
import type { AssistBox, AssistDraft, AssistPromptMode } from "./assist-layer";
import type { EditorFeature, MeasurementFeature } from "./types";

type AssistPoint = { lng: number; lat: number; label: 0 | 1 };

type AssistResponse = {
  run_id: string;
  status: "succeeded";
  features: {
    id: string;
    geometry: GeoJsonGeometry;
    properties: {
      area_m2: string;
      takeoff_item_id: string | null;
    };
  }[];
};

type AssistReview = {
  run_id: string;
  status: "accepted_partial" | "accepted_all";
  measurements: MeasurementFeature[];
};

export type AssistAreaItem = {
  id: string;
};

type AssistInput = {
  enabled: boolean;
  readOnly: boolean;
  takeoffId: string;
  captureId: string | null;
  areaItem: AssistAreaItem | null;
  measurements: readonly EditorFeature[];
  onAccepted: (measurements: MeasurementFeature[]) => void;
};

export function useAssist(input: AssistInput) {
  const [on, setOn] = useState(false);
  const [prompt, setPromptState] = useState<AssistPromptMode>("off");
  const [drafts, setDrafts] = useState<AssistDraft[]>([]);
  const [points, setPoints] = useState<AssistPoint[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [alert, setAlert] = useState("");
  const inputRef = useRef(input);
  const busyRef = useRef(false);
  const stateRef = useRef({
    on,
    prompt,
    points,
    runId,
    armed,
  });
  useEffect(() => {
    inputRef.current = input;
    stateRef.current = { on, prompt, points, runId, armed };
  });

  const active = input.enabled && on;

  const overlap = useMemo(() => {
    if (!input.enabled || drafts.length === 0) {
      return false;
    }
    return drafts.some((draft) =>
      input.measurements.some(
        (feature) => feature.kind === "area" && polygonOverlaps(draft.geometry, feature.geometry),
      ),
    );
  }, [drafts, input.enabled, input.measurements]);

  const send = useCallback(async (nextPoints: AssistPoint[], box?: AssistBox) => {
    const current = inputRef.current;
    const previousRun = stateRef.current.runId;
    if (!current.enabled || current.readOnly || busyRef.current) {
      return;
    }
    if (!current.captureId) {
      setAlert("Choose an imagery capture before using Assist.");
      return;
    }
    if (!current.areaItem) {
      setAlert("Choose an area takeoff item before using Assist.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setAlert("");
    try {
      const result = await api<AssistResponse>(`/takeoffs/${current.takeoffId}/assist`, {
        method: "POST",
        headers: { "idempotency-key": createId() },
        body: JSON.stringify({
          imagery_capture_id: current.captureId,
          takeoff_item_id: current.areaItem.id,
          points: nextPoints,
          ...(box ? { box } : {}),
        }),
      });
      if (result.features.length === 0) {
        setAlert("Assist did not return a polygon. Try another point.");
        return;
      }
      if (previousRun && previousRun !== result.run_id) {
        try {
          await api(`/detections/${previousRun}/reject`, {
            method: "POST",
            body: JSON.stringify({ all: true }),
          });
        } catch {
          // The new draft is the one on the map. The previous run stays succeeded.
        }
      }
      setRunId(result.run_id);
      setPoints(nextPoints);
      setDrafts(
        result.features.map((feature) => ({
          id: feature.id,
          geometry: feature.geometry,
        })),
      );
      setArmed(false);
      setStatus("Draft polygon. Dashed until you accept.");
    } catch (error) {
      setAlert(message(error, "Assist could not finish."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const onPoint = useCallback(
    (lng: number, lat: number) => {
      const state = stateRef.current;
      if (!state.on || (state.prompt !== "positive" && state.prompt !== "negative")) {
        return;
      }
      const point: AssistPoint = {
        lng,
        lat,
        label: state.prompt === "negative" ? 0 : 1,
      };
      const next = state.armed ? [...state.points, point] : [point];
      if (next.length > 32) {
        setAlert("Assist keeps at most 32 points.");
        return;
      }
      if (!next.some((item) => item.label === 1)) {
        setAlert("Add a positive point, or drag a box.");
        return;
      }
      void send(next);
    },
    [send],
  );

  const onBox = useCallback(
    (box: AssistBox) => {
      const state = stateRef.current;
      if (!state.on || state.prompt !== "box") {
        return;
      }
      void send(state.armed ? state.points : [], box);
    },
    [send],
  );

  const accept = useCallback(async () => {
    const state = stateRef.current;
    const current = inputRef.current;
    if (!state.runId || busyRef.current || current.readOnly) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setAlert("");
    try {
      const result = await api<AssistReview>(`/detections/${state.runId}/accept`, {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      current.onAccepted(result.measurements);
      setDrafts([]);
      setPoints([]);
      setRunId(null);
      setArmed(false);
      setPromptState("off");
      setStatus("Accepted. The polygon is a measurement you can edit.");
    } catch (error) {
      setAlert(message(error, "Could not accept the draft."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const discard = useCallback(async () => {
    const state = stateRef.current;
    if (!state.runId || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setAlert("");
    try {
      await api(`/detections/${state.runId}/reject`, {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      setDrafts([]);
      setPoints([]);
      setRunId(null);
      setArmed(false);
      setPromptState("off");
      setStatus("Draft discarded.");
    } catch (error) {
      setAlert(message(error, "Could not discard the draft."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const refine = useCallback(() => {
    const state = stateRef.current;
    if (!state.runId || busyRef.current) {
      return;
    }
    setArmed(true);
    setAlert("");
    if (state.prompt === "off") {
      setPromptState("positive");
    }
    setStatus("Add a positive or negative point, or drag a box, to refine.");
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setOn(next);
    setAlert("");
    if (!next) {
      setPromptState("off");
      setArmed(false);
      return;
    }
    setPromptState((current) => (current === "off" ? "positive" : current));
  }, []);

  const setPrompt = useCallback((mode: AssistPromptMode) => {
    setPromptState(mode);
    if (mode === "off") {
      setArmed(false);
    }
  }, []);

  return {
    on: active,
    prompt: active ? prompt : "off",
    drafts: input.enabled ? drafts : [],
    busy,
    overlap,
    status: active ? status : "",
    alert: active ? alert : "",
    canReview: active && drafts.length > 0,
    setEnabled,
    setPrompt,
    onPoint,
    onBox,
    accept,
    refine,
    discard,
  };
}
