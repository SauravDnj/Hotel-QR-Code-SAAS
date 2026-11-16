import "server-only";
import QRCode from "qrcode";

/**
 * QR images for printing. Error correction "Q" (25%) survives scuffed stickers and small
 * logos; a 4-module quiet zone is what phone camera apps expect.
 */
const OPTIONS = { errorCorrectionLevel: "Q" as const, margin: 4 };

export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...OPTIONS, type: "svg" });
}

export function qrSvgDataUri(url: string): Promise<string> {
  return qrSvg(url).then((svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

export function qrPng(url: string, width = 1024): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...OPTIONS, type: "png", width });
}
