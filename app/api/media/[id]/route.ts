// 素材读取 / 删除：GET /api/media/<id>（支持 Range，视频可拖进度条），DELETE 删除
import { NextRequest } from "next/server";
import { deleteMedia, readMedia } from "@/lib/server/db";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let found;
  try {
    found = await readMedia(id);
  } catch {
    return Response.json({ error: "非法 id" }, { status: 400 });
  }
  if (!found) return Response.json({ error: "素材不存在" }, { status: 404 });

  const { buf, meta } = found;
  const total = buf.length;
  const range = req.headers.get("range");
  const baseHeaders = {
    "Content-Type": meta.contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  // Range：视频播放/拖动需要 206 分段
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
      if (start <= end && start < total) {
        return new Response(new Uint8Array(buf.subarray(start, end + 1)), {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }
    }
  }

  return new Response(new Uint8Array(buf), {
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    await deleteMedia(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
}
