import { inflateSync } from "node:zlib";

export type Rgb = { r: number; g: number; b: number };

/** Read one pixel from an 8-bit non-interlaced RGB or RGBA PNG. */
export function readPngPixel(png: Buffer, x: number, y: number): Rgb {
  const decoded = decodePng(png);
  if (x < 0 || y < 0 || x >= decoded.width || y >= decoded.height) {
    throw new Error(`Pixel ${x},${y} is outside ${decoded.width}x${decoded.height}.`);
  }
  const channels = decoded.channels;
  const index = (y * decoded.width + x) * channels;
  return {
    r: decoded.pixels[index] ?? 0,
    g: decoded.pixels[index + 1] ?? 0,
    b: decoded.pixels[index + 2] ?? 0,
  };
}

function decodePng(png: Buffer): {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
} {
  const signature = png.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error("Not a PNG.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) {
        throw new Error("Only 8-bit non-interlaced PNGs are supported.");
      }
      colorType = data[9] ?? -1;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (channels === 0 || width === 0 || height === 0) {
    throw new Error(`Unsupported PNG color type ${colorType}.`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let src = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[src] ?? 0;
    src += 1;
    const rowStart = row * stride;
    for (let col = 0; col < stride; col += 1) {
      const value = raw[src] ?? 0;
      src += 1;
      const left = col >= channels ? (pixels[rowStart + col - channels] ?? 0) : 0;
      const up = row > 0 ? (pixels[rowStart - stride + col] ?? 0) : 0;
      const upLeft =
        row > 0 && col >= channels ? (pixels[rowStart - stride + col - channels] ?? 0) : 0;
      pixels[rowStart + col] = unfilter(filter, value, left, up, upLeft);
    }
  }
  return { width, height, channels, pixels };
}

function unfilter(filter: number, value: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return value;
    case 1:
      return (value + left) & 255;
    case 2:
      return (value + up) & 255;
    case 3:
      return (value + Math.floor((left + up) / 2)) & 255;
    case 4: {
      const estimate = left + up - upLeft;
      const leftDistance = Math.abs(estimate - left);
      const upDistance = Math.abs(estimate - up);
      const upLeftDistance = Math.abs(estimate - upLeft);
      const predictor =
        leftDistance <= upDistance && leftDistance <= upLeftDistance
          ? left
          : upDistance <= upLeftDistance
            ? up
            : upLeft;
      return (value + predictor) & 255;
    }
    default:
      throw new Error(`Unknown PNG filter ${filter}.`);
  }
}
