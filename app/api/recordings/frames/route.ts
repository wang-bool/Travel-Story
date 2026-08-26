// 纪录片离线渲染：帧接收与服务端合成
//   POST   /api/recordings/frames?session=<id>   body=FormData(frames: 逐张 JPEG，文件名 %06d.jpg)
//   POST   /api/recordings/frames?session=<id>&finalize=1&trip=<名>&fps=<60|30>   ffmpeg 合成 MP4 并清理帧目录
//   DELETE /api/recordings/frames?session=<id>   取消渲染，清理帧目录
import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { ensureDirs, RECORDINGS_DIR } from "@/lib/server/db";

export const maxDuration = 300; // 合成数千帧需要时间

/** 客户端渲染帧率兜底值（正常由 finalize 的 fps 参数传过来） */
const DEFAULT_FPS = 60;

function framesDir(session: string) {
  const safe = session.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  return path.join(RECORDINGS_DIR, `frames-${safe}`);
}

export async function POST(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const session = sp.get("session") ?? "";
    if (!session) return Response.json({ error: "缺 session" }, { status: 400 });
    const dir = framesDir(session);

    if (sp.get("finalize") === "1") {
      // 帧齐了 → 合成 MP4（沿用实时录制的文件命名）
      const tripName = (sp.get("trip") ?? "纪录片").trim() || "纪录片";
      const fpsRaw = Number(sp.get("fps"));
      const fps = Number.isInteger(fpsRaw) && fpsRaw >= 1 && fpsRaw <= 120 ? fpsRaw : DEFAULT_FPS;
      const safeName = tripName.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40);
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "").replace(/-/g, "");
      const finalFile = `${ts}-${safeName}.mp4`;
      const outPath = path.join(RECORDINGS_DIR, finalFile);
      await assemble(dir, outPath, fps);
      await fs.rm(dir, { recursive: true, force: true });
      const stat = await fs.stat(outPath);
      return Response.json({
        ok: true,
        file: finalFile,
        url: `/api/recordings/${finalFile}`,
        size: stat.size,
      });
    }

    // 一批帧：按文件名落盘（%06d.jpg，ffmpeg image2 按序号读）
    const fd = await req.formData();
    const files = fd.getAll("frames");
    if (!files.length) return Response.json({ error: "空批次" }, { status: 400 });
    await ensureDirs();
    await fs.mkdir(dir, { recursive: true });
    await Promise.all(
      files.map(async (f) => {
        const file = f as File;
        const name = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "");
        if (!name) throw new Error(`非法帧文件名: ${file.name}`);
        await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
      })
    );
    return Response.json({ ok: true, count: files.length });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = req.nextUrl.searchParams.get("session") ?? "";
  if (session) {
    await fs.rm(framesDir(session), { recursive: true, force: true }).catch(() => {});
  }
  return Response.json({ ok: true });
}

/** 帧序列 → H.264 MP4。优先 NVENC 硬编（有 NVIDIA GPU 时快 10 倍级），
 *  失败回退 libx264 CRF 18 软编；离线渲染不赶时间，x264 用 medium 提质 */
async function assemble(dir: string, output: string, fps: number): Promise<void> {
  const input = path.join(dir, "%06d.jpg");
  try {
    await runFfmpeg([
      "-y",
      "-framerate", String(fps),
      "-start_number", "0", // 帧从 000000.jpg 起编（image2 默认从 1 开始）
      "-i", input,
      "-c:v", "h264_nvenc",
      "-preset", "slow",
      "-rc", "vbr",
      "-cq", "19", // 与 x264 CRF 18 相当的画质档
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      output,
    ]);
  } catch (e) {
    console.warn("[recordings] NVENC 硬编不可用，回退 libx264", e);
    await runFfmpeg([
      "-y",
      "-framerate", String(fps),
      "-start_number", "0",
      "-i", input,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      output,
    ]);
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { timeout: 280_000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg 合成失败: ${stderr.slice(-400)}`));
      else resolve();
    });
  });
}
