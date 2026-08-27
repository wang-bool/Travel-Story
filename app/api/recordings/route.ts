// 纪录片视频：POST /api/recordings?trip=<行程名>&ext=<webm|mp4>
// body 为浏览器录制的视频字节；webm 一律用 ffmpeg 转码成 mp4（H.264），
// 返回可下载的 url。转码是同步等待的——几十秒的片段几秒就能转完。
import { NextRequest } from "next/server";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { ensureDirs, RECORDINGS_DIR } from "@/lib/server/db";
import {
  RequestTooLargeError,
  getLimitBytes,
  isAllowedVideoType,
  readBodyWithinLimit,
} from "@/lib/server/requestSafety";

export const maxDuration = 300; // 长视频转码需要时间
const MAX_BODY_BYTES = getLimitBytes(process.env.MAX_RECORDING_UPLOAD_MB, 512);

function transcodeToMp4(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y",
        "-i", input,
        "-c:v", "libx264",
        "-preset", "veryfast",
        // 默认 CRF 23 对地图线条/照片细节糊得明显，压到 18 保画质
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output,
      ],
      { timeout: 240_000 },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(`ffmpeg 转码失败: ${stderr.slice(-400)}`));
        else resolve();
      }
    );
  });
}

/**
 * 直传 MP4 来自浏览器 WebCodecs。只解码关键帧即可快速发现坏 SPS、
 * 参考帧等码流错误；FFmpeg 即使返回 0，也会把解码错误写入 stderr。
 */
async function validateMp4(input: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-v", "error", "-skip_frame", "nokey", "-i", input, "-map", "0:v:0", "-f", "null", "-"],
      { timeout: 240_000 },
      (err, _stdout, stderr) => {
        if (err || stderr.trim()) {
          reject(new Error(`MP4 码流校验失败: ${(stderr || err?.message || "unknown").slice(-400)}`));
        } else {
          resolve();
        }
      }
    );
  });
}

export async function POST(req: NextRequest) {
  try {
    const tripName = (req.nextUrl.searchParams.get("trip") ?? "纪录片").trim() || "纪录片";
    const extParam = req.nextUrl.searchParams.get("ext");
    if (extParam !== "mp4" && extParam !== "webm") {
      return Response.json({ error: "invalid-video-extension" }, { status: 400 });
    }
    const ext = extParam;
    const contentType = req.headers.get("content-type") ?? "";
    if (!isAllowedVideoType(contentType, ext)) {
      return Response.json({ error: "unsupported-video-type" }, { status: 400 });
    }
    const buf = await readBodyWithinLimit(req, MAX_BODY_BYTES);
    if (!buf.length) return Response.json({ error: "empty-video" }, { status: 400 });

    await ensureDirs();
    // 文件名：时间戳 + 清洗后的行程名
    const safeName = tripName.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40);
    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "").replace(/-/g, "");
    const base = `${ts}-${safeName}`;
    const rawPath = path.join(RECORDINGS_DIR, `${base}.${ext}`);
    await fs.writeFile(rawPath, buf);

    let finalFile = `${base}.${ext}`;
    if (ext === "mp4") {
      try {
        await validateMp4(rawPath);
      } catch (e) {
        await fs.unlink(rawPath).catch(() => {});
        console.warn("[recordings] 拒绝损坏 MP4", e);
        return Response.json({ error: "invalid-video-stream" }, { status: 422 });
      }
    } else {
      // 浏览器给的是 webm → 转成通用 mp4
      const mp4Path = path.join(RECORDINGS_DIR, `${base}.mp4`);
      try {
        await transcodeToMp4(rawPath, mp4Path);
        await fs.unlink(rawPath);
        finalFile = `${base}.mp4`;
      } catch (e) {
        // 转码失败不丢原片：保留 webm 照常返回
        console.warn("[recordings] 转码失败，保留 webm", e);
      }
    }

    const stat = await fs.stat(path.join(RECORDINGS_DIR, finalFile));
    return Response.json({
      ok: true,
      file: finalFile,
      url: `/api/recordings/${finalFile}`,
      size: stat.size,
    });
  } catch (e) {
    if (e instanceof RequestTooLargeError) {
      return Response.json({ error: "request-too-large" }, { status: 413 });
    }
    console.error("[recordings] 录像写入失败", e);
    return Response.json({ error: "recording-failed" }, { status: 500 });
  }
}
