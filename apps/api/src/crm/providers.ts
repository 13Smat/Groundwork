/**
 * Geocoder and parcel adapters for local and CI. They answer from fixtures.
 * They do not call the network and they do not read API keys. ADR 0009.
 * Parcel rows cached from these adapters are not ML training input.
 */

export type LatLng = {
  lat: number;
  lng: number;
};

export type PostalAddress = {
  line1: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

export type GeocodeHit = {
  point: LatLng;
  formatted: string;
  address: PostalAddress;
};

export type GeocodeQuery = {
  address?: string;
  point?: LatLng;
};

export interface GeocoderProvider {
  geocode(query: GeocodeQuery): Promise<GeocodeHit | null>;
}

export type GeoJsonMultiPolygon = {
  type: "MultiPolygon";
  coordinates: number[][][][];
};

export type ParcelCandidate = {
  providerParcelId: string;
  geom: GeoJsonMultiPolygon;
  attrs: Record<string, unknown>;
};

export interface ParcelProvider {
  readonly name: string;
  lookup(point: LatLng): Promise<ParcelCandidate[]>;
}

/**
 * A site inside the seeded NC coverage and the fixture COG bounds
 * (db/seed/fixtures/rgbir-cog.json). Tests and the fixture adapter share it.
 */
export const MORGANTON_MAIN = {
  point: { lat: 35.748741, lng: -81.702576 },
  address: {
    line1: "100 Main St",
    city: "Morganton",
    region: "NC",
    postal_code: "28655",
    country: "US",
  } satisfies PostalAddress,
  formatted: "100 Main St, Morganton, NC 28655",
};

export function normalizeAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\bstreet\b/g, "st")
    .replace(/\broad\b/g, "rd")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\s+/g, " ")
    .trim();
}

const MORGANTON_KEY = normalizeAddress(MORGANTON_MAIN.formatted);

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function square(point: LatLng): GeoJsonMultiPolygon {
  const lat = round5(point.lat);
  const lng = round5(point.lng);
  const delta = 0.00015;
  const ring = [
    [lng - delta, lat - delta],
    [lng + delta, lat - delta],
    [lng + delta, lat + delta],
    [lng - delta, lat + delta],
    [lng - delta, lat - delta],
  ];
  return { type: "MultiPolygon", coordinates: [[ring]] };
}

export function fixtureParcelId(point: LatLng): string {
  return `fixture:${round5(point.lat).toFixed(5)}:${round5(point.lng).toFixed(5)}`;
}

export function createFixtureGeocoder(): GeocoderProvider {
  return {
    async geocode(query) {
      if (query.address !== undefined && query.address.trim() !== "") {
        const key = normalizeAddress(query.address);
        if (key === MORGANTON_KEY || key === normalizeAddress("100 Main St, Morganton, NC")) {
          return {
            point: MORGANTON_MAIN.point,
            formatted: MORGANTON_MAIN.formatted,
            address: MORGANTON_MAIN.address,
          };
        }
        return null;
      }
      if (query.point) {
        const lat = round5(query.point.lat);
        const lng = round5(query.point.lng);
        return {
          point: { lat: query.point.lat, lng: query.point.lng },
          formatted: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          address: { line1: "Dropped pin", country: "US" },
        };
      }
      return null;
    },
  };
}

export function createFixtureParcelProvider(): ParcelProvider {
  return {
    name: "fixture",
    async lookup(point) {
      return [
        {
          providerParcelId: fixtureParcelId(point),
          geom: square(point),
          attrs: { fixture: true, allows_ml_training: false },
        },
      ];
    },
  };
}
