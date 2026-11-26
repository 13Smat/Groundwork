import { crc32, deflateSync } from "node:zlib";

import type { GeoJsonGeometry, LngLat } from "@groundwork/geo";

import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphRows } from "./bitmap-font.js";

const WIDTH = 640;
const HEIGHT = 480;
const FOOTER = 56;
const PAPER: Rgba = [217, 209, 195, 255];
const INK: Rgba = [28, 25, 21, 255];
const AREA: Rgba = [122, 52, 16, 150];

type Rgba = [number, number, number, number];

export type SiteMapFeature = {
  kind: "area" | "length" | "count";
  geometry: GeoJsonGeometry;
};

export type SiteMapStamp = {
  provider: string;
  name: string;
  captureDate: string;
  gsdCm: string;
  attribution: string | null;
};

export type SiteMapImage = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

type Point = [number, number];

function paper(): Uint8Array {
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = PAPER[0];
    rgba[index + 1] = PAPER[1];
    rgba[index + 2] = PAPER[2];
    rgba[index + 3] = PAPER[3];
  }
  return rgba;
}

function blend(rgba: Uint8Array, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) {
    return;
  }
  const offset = (y * WIDTH + x) * 4;
  const alpha = color[3] / 255;
  const current = rgba[offset];
  const currentG = rgba[offset + 1];
  const currentB = rgba[offset + 2];
  if (current === undefined || currentG === undefined || currentB === undefined) {
    return;
  }
  rgba[offset] = Math.round(color[0] * alpha + current * (1 - alpha));
  rgba[offset + 1] = Math.round(color[1] * alpha + currentG * (1 - alpha));
  rgba[offset + 2] = Math.round(color[2] * alpha + currentB * (1 - alpha));
  rgba[offset + 3] = 255;
}

function fillRect(
  rgba: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgba,
) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      blend(rgba, col, row, color);
    }
  }
}

function positionsOf(geometry: GeoJsonGeometry): LngLat[] {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
    default:
      return [];
  }
}

function boundsOf(points: readonly LngLat[]): {
  west: number;
  south: number;
  east: number;
  north: number;
} | null {
  if (points.length === 0) {
    return null;
  }
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (east - west < 1e-8) {
    west -= 0.0001;
    east += 0.0001;
  }
  if (north - south < 1e-8) {
    south -= 0.0001;
    north += 0.0001;
  }
  const padX = (east - west) * 0.08;
  const padY = (north - south) * 0.08;
  return { west: west - padX, east: east + padX, south: south - padY, north: north + padY };
}

function projector(bounds: { west: number; south: number; east: number; north: number }) {
  const mapHeight = HEIGHT - FOOTER;
  return (lng: number, lat: number): Point => [
    ((lng - bounds.west) / (bounds.east - bounds.west)) * (WIDTH - 1),
    ((bounds.north - lat) / (bounds.north - bounds.south)) * (mapHeight - 1),
  ];
}

function fillRings(rgba: Uint8Array, rings: Point[][], color: Rgba): void {
  const limit = HEIGHT - FOOTER;
  for (let y = 0; y < limit; y += 1) {
    const sample = y + 0.5;
    const crossings: number[] = [];
    for (const ring of rings) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const start = ring[index];
        const end = ring[index + 1];
        if (!start || !end) {
          continue;
        }
        const crosses =
          (start[1] <= sample && end[1] > sample) || (end[1] <= sample && start[1] > sample);
        if (!crosses || end[1] === start[1]) {
          continue;
        }
        const t = (sample - start[1]) / (end[1] - start[1]);
        crossings.push(start[0] + t * (end[0] - start[0]));
      }
    }
    crossings.sort((left, right) => left - right);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const from = crossings[index];
      const to = crossings[index + 1];
      if (from === undefined || to === undefined) {
        continue;
      }
      const start = Math.max(0, Math.ceil(from));
      const end = Math.min(WIDTH - 1, Math.floor(to));
      for (let x = start; x <= end; x += 1) {
        blend(rgba, x, y, color);
      }
    }
  }
}

function stroke(rgba: Uint8Array, points: Point[], color: Rgba): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) {
      continue;
    }
    const steps = Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]), 1);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = Math.round(start[0] + (end[0] - start[0]) * t);
      const y = Math.round(start[1] + (end[1] - start[1]) * t);
      blend(rgba, x, y, color);
      blend(rgba, x + 1, y, color);
    }
  }
}

function dot(rgba: Uint8Array, point: Point, color: Rgba): void {
  const cx = Math.round(point[0]);
  const cy = Math.round(point[1]);
  for (let y = cy - 4; y <= cy + 4; y += 1) {
    for (let x = cx - 4; x <= cx + 4; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= 16) {
        blend(rgba, x, y, color);
      }
    }
  }
}

function projectRing(ring: LngLat[], project: (lng: number, lat: number) => Point): Point[] {
  return ring.map(([lng, lat]) => project(lng, lat));
}

function drawGeometry(
  rgba: Uint8Array,
  feature: SiteMapFeature,
  project: (lng: number, lat: number) => Point,
): void {
  const geometry = feature.geometry;
  if (geometry.type === "Polygon") {
    fillRings(
      rgba,
      geometry.coordinates.map((ring) => projectRing(ring, project)),
      AREA,
    );
    for (const ring of geometry.coordinates) {
      stroke(rgba, projectRing(ring, project), INK);
    }
    return;
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      fillRings(
        rgba,
        polygon.map((ring) => projectRing(ring, project)),
        AREA,
      );
      for (const ring of polygon) {
        stroke(rgba, projectRing(ring, project), INK);
      }
    }
    return;
  }
  if (geometry.type === "LineString") {
    stroke(rgba, projectRing(geometry.coordinates, project), INK);
    return;
  }
  if (geometry.type === "MultiLineString") {
    for (const line of geometry.coordinates) {
      stroke(rgba, projectRing(line, project), INK);
    }
    return;
  }
  if (geometry.type === "Point") {
    dot(rgba, project(geometry.coordinates[0], geometry.coordinates[1]), INK);
    return;
  }
  for (const [lng, lat] of geometry.coordinates) {
    dot(rgba, project(lng, lat), INK);
  }
}

function drawText(rgba: Uint8Array, text: string, x: number, y: number, color: Rgba): void {
  let cursor = x;
  const scale = 2;
  for (const character of text) {
    const rows = glyphRows(character);
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      const bits = rows[row] ?? "00000";
      for (let col = 0; col < GLYPH_WIDTH; col += 1) {
        if (bits[col] !== "1") {
          continue;
        }
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            blend(rgba, cursor + col * scale + sx, y + row * scale + sy, color);
          }
        }
      }
    }
    cursor += (GLYPH_WIDTH + 1) * scale;
    if (cursor > WIDTH - 8) {
      return;
    }
  }
}

function stampLines(stamp: SiteMapStamp | null): [string, string] {
  if (!stamp) {
    return ["NO IMAGERY CAPTURE", ""];
  }
  const attribution = stamp.attribution ?? "Attribution not recorded";
  return [`${stamp.name}  ${stamp.captureDate}  ${stamp.gsdCm} CM`, attribution];
}

/** Paper site map with measurement ink and a footer stamp. No tile service is called. */
export function paintSiteMap(
  features: readonly SiteMapFeature[],
  stamp: SiteMapStamp | null,
): SiteMapImage {
  const rgba = paper();
  const points = features.flatMap((feature) => positionsOf(feature.geometry));
  const bounds = boundsOf(points) ?? { west: -1, south: -1, east: 1, north: 1 };
  const project = projector(bounds);
  for (const feature of features) {
    drawGeometry(rgba, feature, project);
  }
  fillRect(rgba, 0, HEIGHT - FOOTER, WIDTH, FOOTER, INK);
  const [line, attribution] = stampLines(stamp);
  drawText(rgba, line.toUpperCase(), 8, HEIGHT - FOOTER + 6, PAPER);
  drawText(rgba, attribution.toUpperCase(), 8, HEIGHT - FOOTER + 28, PAPER);
  return { width: WIDTH, height: HEIGHT, rgba };
}

export function countInk(image: SiteMapImage): number {
  let ink = 0;
  for (let index = 0; index < image.rgba.length; index += 4) {
    const red = image.rgba[index];
    const green = image.rgba[index + 1];
    const blue = image.rgba[index + 2];
    if (red !== PAPER[0] || green !== PAPER[1] || blue !== PAPER[2]) {
      ink += 1;
    }
  }
  return ink;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0, 0);
  return Buffer.concat([length, name, data, sum]);
}

function textChunk(keyword: string, value: string): Buffer {
  return chunk(
    "tEXt",
    Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(value, "latin1")]),
  );
}

export function encodeRgbaPng(
  image: SiteMapImage,
  texts: readonly { keyword: string; text: string }[],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines: Buffer[] = [];
  const stride = image.width * 4;
  for (let y = 0; y < image.height; y += 1) {
    const row = Buffer.alloc(1 + stride);
    row[0] = 0;
    Buffer.from(image.rgba.buffer, image.rgba.byteOffset + y * stride, stride).copy(row, 1);
    scanlines.push(row);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    ...texts.map((entry) => textChunk(entry.keyword, entry.text)),
    chunk("IDAT", deflateSync(Buffer.concat(scanlines))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function renderSiteMap(
  features: readonly SiteMapFeature[],
  stamp: SiteMapStamp | null,
): Buffer {
  const image = paintSiteMap(features, stamp);
  const texts = stamp
    ? [
        { keyword: "Provider", text: stamp.provider },
        { keyword: "Name", text: stamp.name },
        { keyword: "CaptureDate", text: stamp.captureDate },
        { keyword: "GsdCm", text: stamp.gsdCm },
        { keyword: "Attribution", text: stamp.attribution ?? "" },
      ]
    : [{ keyword: "Attribution", text: "No imagery capture" }];
  return encodeRgbaPng(image, texts);
}
