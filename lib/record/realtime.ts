"use client";

// ============================================================
// Travel Story — 纪录片实时录制器
//
// 思路：先沿时间轴预热一遍（瓦片/字形进缓存），再按墙钟实时
// 播放行程，合成器逐帧画到输出画布，MediaRecorder 直接录画布
// 流，服务端转码成 MP4。演示什么样，成片就什么样。
//
// 与逐帧离线渲染的取舍：快（耗时≈成片时长+预热）、管线短；
// 代价是机器抖动会录进成片——预热 + 瓦片本地缓存把抖动压到
// 最低，赶时间还可以选 720P / 30fps 进一步减负。
// ============================================================

import { buildTimeline, playTrip, type PlaybackController } from "@/lib/map/playback";
import type { TravelMapEngine } from "@/lib/map/engine";
import type { Trip } from "@/lib/types";
import type { Compositor } from "./compositor";
import { prewarmTimeline } from "./prewarm";

/** 片尾字幕时长（录完行程再录几秒收尾画面） */
const OUTRO_MS = 2600;
/** 1080P60 的录制码率；其他规格按 像素×帧率 等比缩放 */
const BITRATE_1080P60 = 16_000_000;
/** 进度上报间隔 */
const PROGRESS_MS = 250;

export type RecordPhase = "prewarm" | "record" | "encode";

export interface RecordResult {
  file: string;
  url: string;
  size: number;
}

export interface RealtimeRecorder {
  cancel(): void;
  /** resolve 结果；null 表示用户取消 */
  done: Promise<RecordResult | null>;
}

/** MediaRecorder 容器/编码探测：优先 MP4(H.264) 免转码，其次 WebM(VP9/VP8) */
function pickRecorderMime(): { mimeType: string; ext: "mp4" | "webm" } {
  const candidates: [string, "mp4" | "webm"][] = [
    ['video/mp4;codecs="avc1.64002A"', "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mimeType, ext] of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType, ext };
    }
  }
  return { mimeType: "", ext: "webm" };
}

export function recordRealtime({
  engine,
  trip,
  compositor,
  fps,
  onProgress,
}: {
  engine: TravelMapEngine;
  trip: Trip;
  compositor: Compositor;
  /** 录制帧率：60 丝滑 / 30 轻量 */
  fps: number;
  onProgress(elapsedMs: number, totalMs: number, phase: RecordPhase): void;
}): RealtimeRecorder {
  let cancelled = false;
  let playback: PlaybackController | null = null;
  let recorder: MediaRecorder | null = null;
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  const done = (async (): Promise<RecordResult | null> => {
    const map = engine.map;
    try {
      // 1. 时间轴：拿总时长（进度条用）+ 供预热抽样
      const tl = await buildTimeline({
        engine,
        stops: trip.stops,
        segments: trip.segments,
        stopDwellMs: (s) => compositor.dwellMs(s),
      });
      const totalMs = tl.totalMs + OUTRO_MS;

      // 2. 录制器：直接录输出画布流，码率随规格缩放
      const { mimeType, ext } = pickRecorderMime();
      const w = compositor.canvas.width;
      const h = compositor.canvas.height;
      recorder = new MediaRecorder(compositor.canvas.captureStream(fps), {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: Math.round(
          (BITRATE_1080P60 * w * h * fps) / (1920 * 1080 * 60)
        ),
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      console.log(`[travel-story] 实时录制: ${ext} ${w}×${h} ${fps}fps`);

      // 3. 预热：瓦片/字形先进缓存，正式录制不等元素
      onProgress(0, totalMs, "prewarm");
      const syncRender =
        typeof map._render === "function"
          ? (t: number) => {
              map._render(t);
            }
          : null;
      await prewarmTimeline(map, engine, tl, syncRender, () => cancelled);
      if (cancelled) return null;

      // 4. 实时播放 + 录制（引擎状态由 playTrip 自己管）
      const t0 = performance.now();
      progressTimer = setInterval(
        () => onProgress(Math.min(performance.now() - t0, totalMs), totalMs, "record"),
        PROGRESS_MS
      );
      onProgress(0, totalMs, "record");
      recorder.start(1000);
      compositor.start();
      await new Promise<void>((resolve) => {
        playback = playTrip({
          engine,
          stops: trip.stops,
          segments: trip.segments,
          stopDwellMs: (s) => compositor.dwellMs(s),
          callbacks: {
            onShot: (shot) => compositor.updateShot(shot),
            onEnd: () => resolve(),
          },
        });
      });
      if (cancelled) return null;

      // 5. 片尾：字幕渐显，再录几秒收尾
      compositor.showOutro();
      await new Promise<void>((r) => setTimeout(r, OUTRO_MS));
      if (cancelled) return null;

      // 6. 收流上传（webm 由服务端转码成 mp4）
      onProgress(totalMs, totalMs, "encode");
      const blob = await new Promise<Blob>((resolve) => {
        if (!recorder || recorder.state === "inactive") {
          resolve(new Blob(chunks, { type: mimeType || undefined }));
          return;
        }
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || undefined }));
        recorder.stop();
      });
      if (cancelled) return null;
      const res = await fetch(
        `/api/recordings?trip=${encodeURIComponent(trip.name)}&ext=${ext}`,
        { method: "POST", body: blob }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json as RecordResult;
    } finally {
      if (progressTimer) clearInterval(progressTimer);
    }
  })();

  return {
    cancel: () => {
      cancelled = true;
      playback?.cancel();
      // 停掉录制但不上传（done 里按 cancelled 返回 null）
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        /* 已停止 */
      }
    },
    done,
  };
}
