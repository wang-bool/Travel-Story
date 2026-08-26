// 素材上传：POST /api/media?id=<id>&name=<原始文件名>，body 为文件字节
import { NextRequest } from "next/server";
import { writeMedia } from "@/lib/server/db";

export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const name = req.nextUrl.searchParams.get("name") ?? "未命名";
  if (!id) return Response.json({ error: "缺 id" }, { status: 400 });
  const contentType = req.headers.get("content-type") ?? "application/octet-stream";
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) return Response.json({ error: "空文件" }, { status: 400 });
    await writeMedia(id, buf, { contentType, name });
    return Response.json({ ok: true, id, size: buf.length });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
