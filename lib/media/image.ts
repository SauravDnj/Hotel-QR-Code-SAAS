/**
 * Server-side image checks. The browser already resized the photo; here we trust nothing:
 * the type comes from the file's magic bytes (never the file name or the client's MIME type),
 * and SVG/HTML/anything else is refused so an upload can never become a script.
 */

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export interface ImageInfo {
  type: ImageType;
  width: number | null;
  height: number | null;
}

export function sniffImage(b: Buffer): ImageInfo | null {
  if (b.length < 16) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width/height at 16..23
  if (b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) {
    return { type: "image/png", width: b.length >= 24 ? b.readUInt32BE(16) : null, height: b.length >= 24 ? b.readUInt32BE(20) : null };
  }
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { type: "image/jpeg", ...jpegSize(b) };
  }
  // WebP: "RIFF" .... "WEBP"
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    return { type: "image/webp", ...webpSize(b) };
  }
  return null;
}

function jpegSize(b: Buffer): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return { width: null, height: null };
}

function webpSize(b: Buffer): { width: number | null; height: number | null } {
  const chunk = b.toString("latin1", 12, 16);
  if (chunk === "VP8X" && b.length >= 30) {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  if (chunk === "VP8 " && b.length >= 30) {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { width: null, height: null };
}
