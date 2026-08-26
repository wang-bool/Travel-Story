// 素材上传：POST /api/media?id=<id>&name=<原始文件名>，body 为文件字节
import { NextRequest } from "next/server";
import { writeMedia } from "@/lib/server/db";
import {
  RequestTooLargeError,
  getLimitBytes,
  isAllowedMediaType,
  isMediaId,
  readBodyWithinLimit,
  safeDisplayName,
} from "@/lib/server/requestSafety";

const MAX_BODY_BYTES = getLimitBytes(process.env.MAX_MEDIA_UPLOAD_MB, 250);

export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !isMediaId(id)) {
    return Response.json({ error: "invalid-media-id" }, { status: 400 });
  }
  const name = safeDisplayName(req.nextUrl.searchParams.get("name") ?? "", "未命名");
  const contentType = req.headers.get("content-type") ?? "application/octet-stream";
  if (!isAllowedMediaType(contentType)) {
    return Response.json({ error: "unsupported-media-type" }, { status: 400 });
  }
  try {
    const buf = await readBodyWithinLimit(req, MAX_BODY_BYTES);
    if (!buf.length) return Response.json({ error: "empty-file" }, { status: 400 });
    await writeMedia(id, buf, { contentType, name });
    return Response.json({ ok: true, id, size: buf.length });
  } catch (e) {
    if (e instanceof RequestTooLargeError) {
      return Response.json({ error: "request-too-large" }, { status: 413 });
    }
    console.error("[media] 上传失败", e);
    return Response.json({ error: "upload-failed" }, { status: 500 });
  }
}
