const BYTES_PER_MB = 1024 * 1024;

export class RequestTooLargeError extends Error {
  constructor() {
    super("request-too-large");
    this.name = "RequestTooLargeError";
  }
}

type BodyRequest = {
  headers: Headers;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export function getLimitBytes(raw: string | undefined, fallbackMb: number): number {
  const parsed = Number(raw);
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
  return Math.floor(mb * BYTES_PER_MB);
}

export function declaredBodyExceeds(headers: Headers, maxBytes: number): boolean {
  const declared = Number(headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}

export async function readBodyWithinLimit(
  req: BodyRequest,
  maxBytes: number
): Promise<Buffer> {
  if (declaredBodyExceeds(req.headers, maxBytes)) {
    throw new RequestTooLargeError();
  }
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > maxBytes) throw new RequestTooLargeError();
  return body;
}

export const isMediaId = (value: string): boolean =>
  /^[A-Za-z0-9_-]{1,128}$/.test(value);

export const isSessionId = (value: string): boolean =>
  /^[A-Za-z0-9-]{1,64}$/.test(value);

export const isFrameName = (value: string): boolean =>
  /^\d{6}\.jpg$/.test(value);

export function isAllowedMediaType(value: string): boolean {
  const type = value.split(";", 1)[0].trim().toLowerCase();
  return (
    type === "application/octet-stream" ||
    /^image\/[a-z0-9.+-]+$/.test(type) ||
    /^video\/[a-z0-9.+-]+$/.test(type)
  );
}

export function isAllowedVideoType(value: string, ext: "mp4" | "webm"): boolean {
  const type = value.split(";", 1)[0].trim().toLowerCase();
  return ext === "mp4" ? type === "video/mp4" : type === "video/webm";
}

export function safeDisplayName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned || fallback;
}
