import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MORGANTON_MAIN,
  createFixtureGeocoder,
  createFixtureParcelProvider,
  fixtureParcelId,
} from "./providers.js";

describe("fixture geocoder and parcel provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the Morganton fixture and refuses an unknown address without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const geocoder = createFixtureGeocoder();
    const hit = await geocoder.geocode({ address: "100 Main Street, Morganton, NC 28655" });
    expect(hit?.point).toEqual(MORGANTON_MAIN.point);
    expect(hit?.address.line1).toBe("100 Main St");
    expect(hit?.point.lat).toBeGreaterThan(35);
    expect(hit?.point.lat).toBeLessThan(36.6);
    expect(hit?.point.lng).toBeGreaterThan(-84.4);
    expect(hit?.point.lng).toBeLessThan(-80.8);
    expect(await geocoder.geocode({ address: "1 Uncoded Ridge, Nowhere, NC" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reverse geocodes a dropped pin and caches a stable parcel id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const geocoder = createFixtureGeocoder();
    const parcels = createFixtureParcelProvider();
    const point = { lat: 35.7487412, lng: -81.7025756 };
    const pin = await geocoder.geocode({ point });
    expect(pin?.point).toEqual(point);
    expect(pin?.address.line1).toBe("Dropped pin");
    const first = await parcels.lookup(point);
    const second = await parcels.lookup(point);
    expect(second).toEqual(first);
    expect(first[0]?.providerParcelId).toBe(fixtureParcelId(point));
    expect(first[0]?.geom.type).toBe("MultiPolygon");
    expect(first[0]?.attrs.allows_ml_training).toBe(false);
    expect(parcels.name).toBe("fixture");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
