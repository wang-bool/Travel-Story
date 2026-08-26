// 纪录片下载：GET /api/recordings/<file>?download=1
import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { RECORDINGS_DIR } from "@/lib/server/db";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ file: string }> }
) {
  const { file } = await ctx.params;
  // 防目录穿越：只要纯文件名
  const safe = path.basename(file);
  if (safe !== file || !/\.(mp4|webm)$/.test(safe)) {
    return Response.json({ error: "非法文件名" }, { status: 400 });
  }
  try {
    const buf = await fs.readFile(path.join(RECORDINGS_DIR, safe));
    const isMp4 = safe.endsWith(".mp4");
    const download = req.nextUrl.searchParams.get("download") === "1";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": isMp4 ? "video/mp4" : "video/webm",
        "Content-Length": String(buf.length),
        ...(download
          ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safe)}` }
          : {}),
      },
    });
  } catch {
    return Response.json({ error: "文件不存在" }, { status: 404 });
  }
}
