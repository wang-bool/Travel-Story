"use client";

// ============================================================
// Travel Story — 纪录片离线渲染泵
//
// 用虚拟时钟逐帧驱动：时间轴（buildTimeline）给出每一帧的精确
// 相机/载具状态 → MapLibre jumpTo 摆好镜头 → 渲染 → 合成器画出
// 这一帧 → 输出通道编码 → MP4。
// 不跟墙钟赛跑：机器慢就慢点渲，成片帧间隔严格相等，绝不掉帧。
//
// 渲染不等屏幕刷新：MapLibre 常规重绘走 rAF，会被显示器刷新率
// 锁住（60Hz 下每帧白等 16.7ms）。离线渲染没有这个必要——优先
// 调 Map._render() 同步出帧（老内核没这个私有入口则回退等
// render 事件），每帧让渡一次宏任务保住 UI 响应。
//
// 速度优化：
//  A. 流水线并行：JPEG 编码 / 批次上传都在后台飞，渲染不等；
//  B. 静态帧去重：镜头静止 ≥150ms、无载具、无动态素材的帧与上一帧
//     完全相同，直接复用，不渲染不编码；
//  C. WebCodecs 软件编码：VideoFrame 零拷贝喂
//     VideoEncoder，浏览器内直接出 MP4——免 JPEG、免分批上传、
//     免服务端二次编码；都不支持则回退 JPEG 帧序列通道（A+B 兜底）。
// ============================================================

import { buildTimeline } from "@/lib/map/playback";
import { formatDistance } from "@/lib/routing";
import type { Timeline } from "@/lib/map/playback";
import type { TravelMapEngine } from "@/lib/map/engine";
import type { Trip } from "@/lib/types";
import type { Compositor } from "./compositor";
import { prewarmTimeline, settle, type MapInstance } from "./prewarm";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
/** 片尾字幕时长（与实时录制一致） */
const OUTRO_MS = 2600;
const JPEG_Q = 0.95;
/** 单帧等瓦片加载的上限（预热后基本不会触发） */
const TILE_WAIT_CAP_MS = 1500;
/** 载具两帧动画的切帧间隔（与 playTrip 一致） */
const VEHICLE_FRAME_MS = 260;
/** 编码/上传在飞队列上限：藏住后台耗时，不阻塞渲染 */
const IN_FLIGHT = 8;
/** 静态帧判定窗口：镜头需已静止这么久，才认为与上一帧完全相同 */
const STATIC_HOLD_MS = 150;
/** 1080P60 的编码码率（给足保画质）；其他规格按像素量等比缩放 */
const HW_BITRATE_1080P = 16_000_000;

export interface OfflineRenderResult {
  file: string;
  url: string;
  size: number;
}

export type RenderPhase = "prewarm" | "render" | "encode";

export interface OfflineRenderer {
  cancel(): void;
  /** resolve 结果；null 表示用户取消 */
  done: Promise<OfflineRenderResult | null>;
}

class WebCodecsOutputError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/** 输出通道：渲染泵只管每帧喂画布，怎么变成 MP4 由通道决定 */
interface FrameSink {
  /** reuse=true 表示该帧与上一帧完全相同（静态帧去重） */
  addFrame(idx: number, canvas: HTMLCanvasElement, reuse: boolean): Promise<void>;
  /** 全部帧喂完 → 产出 MP4 并返回下载信息 */
  finalize(): Promise<OfflineRenderResult>;
  /** 取消时释放资源 */
  dispose(): void;
}

export function renderOffline({
  engine,
  trip,
  compositor,
  width,
  height,
  fps,
  onProgress,
}: {
  engine: TravelMapEngine;
  trip: Trip;
  compositor: Compositor;
  /** 输出像素尺寸（与合成器画布一致） */
  width: number;
  height: number;
  /** 输出帧率：60 丝滑 / 30 快速（帧数减半，渲染快一倍） */
  fps: number;
  onProgress(rendered: number, total: number, phase: RenderPhase): void;
}): OfflineRenderer {
  let cancelled = false;
  const run = async (forceJpeg: boolean): Promise<OfflineRenderResult | null> => {
    let session = "";
    let yieldChannel: MessageChannel | null = null;
    let usedWebCodecs = false;
    const frameMs = 1000 / fps;
    const map = engine.map;
    const t0 = performance.now();
    try {
      // 1. 时间轴：行程 → 每一帧的精确相机/载具/已行驶状态
      const tl = await buildTimeline({
        engine,
        stops: trip.stops,
        segments: trip.segments,
        stopDwellMs: (s) => compositor.dwellMs(s),
      });
      const totalFrames =
        Math.ceil(tl.totalMs / frameMs) + Math.ceil(OUTRO_MS / frameMs);

      // 2. 输出通道：WebCodecs 软件 H.264，不可用则 JPEG 帧序列兜底
      const encConfig = forceJpeg ? null : await pickEncoderConfig(width, height, fps);
      usedWebCodecs = Boolean(encConfig);
      session = crypto.randomUUID();
      const sink: FrameSink = encConfig
        ? createWebCodecsSink(encConfig, width, height, fps, trip.name)
        : createJpegSink(session, trip.name, fps);
      console.log(
        "[travel-story] 渲染通道:",
        encConfig
          ? `WebCodecs ${encConfig.hardwareAcceleration === "prefer-hardware" ? "硬件" : "软件"}编码`
          : "JPEG 帧序列（WebCodecs 不可用，A+B 兜底）"
      );

      // 3. 引擎状态（同 playTrip 播放期）
      engine.setAutoProjection(false);
      engine.setRoutesVisible(false);
      engine.setProjection("mercator");
      engine.clearTraveled();
      engine.hideVehicle();

      // 帧驱动：优先 Map._render() 同步渲染——离线渲染不等屏幕刷新
      // （rAF/vsync，60Hz 下每帧白等 16.7ms）；没有该私有入口则回退等 render 事件
      const syncRender =
        typeof map._render === "function"
          ? (t: number) => {
              map._render(t);
            }
          : null;
      // 同步渲染让循环可能一连几十帧不碰宏任务，UI（进度/取消）会冻死；
      // MessageChannel 是不被 4ms 钳制的宏任务让渡，每帧让一次
      const channel = new MessageChannel();
      yieldChannel = channel;
      let yieldResolve: (() => void) | null = null;
      channel.port1.onmessage = () => {
        const r = yieldResolve;
        yieldResolve = null;
        r?.();
      };
      const yieldTask = () =>
        new Promise<void>((r) => {
          yieldResolve = r;
          channel.port2.postMessage(0);
        });
      console.log(
        "[travel-story] 帧驱动:",
        syncRender ? "Map._render() 同步渲染（不等屏幕刷新）" : "render 事件（回退）"
      );

      // 4. 瓦片预热：沿时间轴抽样预飞一遍，瓦片先进缓存
      onProgress(0, totalFrames, "prewarm");
      const tPrewarm = performance.now();
      await prewarmTimeline(map, engine, tl, syncRender, () => cancelled);
      if (cancelled) {
        sink.dispose();
        return null;
      }
      const prewarmMs = performance.now() - tPrewarm;

      // 5. 逐帧渲染（静态帧跳过渲染与编码，直接复用上一帧）
      let shotIdx = 0;
      let outroStarted = false;
      let currentShotStart = 0;
      let rendered = 0;
      let reused = 0;
      const tRender = performance.now();

      for (let i = 0; i < totalFrames; i++) {
        if (cancelled) {
          sink.dispose();
          return null;
        }
        const tMs = i * frameMs;
        if (tMs < tl.totalMs) {
          // 镜头切换（场记字幕/素材计时都以虚拟时刻为准）
          while (shotIdx < tl.shots.length && tl.shots[shotIdx].startMs <= tMs) {
            compositor.updateShot(tl.shots[shotIdx].shot, tl.shots[shotIdx].startMs);
            currentShotStart = tl.shots[shotIdx].startMs;
            shotIdx++;
          }
        } else if (!outroStarted) {
          // 片尾：镜头停在最后一个地点特写，字幕渐显
          compositor.showOutro(tl.totalMs);
          outroStarted = true;
          currentShotStart = tMs;
        }

        const reuse =
          i > 0 && canReuseFrame(map, tl, compositor, tMs, currentShotStart);
        if (reuse) {
          reused++;
        } else {
          applyFrame(map, engine, tl, Math.min(tMs, tl.totalMs - 1));
          await settle(map, TILE_WAIT_CAP_MS, syncRender);
          await compositor.renderFrame(tMs);
          rendered++;
        }
        await sink.addFrame(i, compositor.canvas, reuse);
        await yieldTask();
        onProgress(i + 1, totalFrames, "render");
      }
      const renderMs = performance.now() - tRender;
      if (cancelled) {
        sink.dispose();
        return null;
      }

      // 6. 收尾产出 MP4
      onProgress(totalFrames, totalFrames, "encode");
      const tEncode = performance.now();
      const result = await sink.finalize();
      console.log(
        `[travel-story] 渲染完成：预热 ${(prewarmMs / 1000).toFixed(1)}s · ` +
          `渲染 ${(renderMs / 1000).toFixed(1)}s（实渲 ${rendered} 帧 / 复用 ${reused} 帧）· ` +
          `收尾 ${((performance.now() - tEncode) / 1000).toFixed(1)}s · ` +
          `总计 ${((performance.now() - t0) / 1000).toFixed(1)}s`
      );
      return result;
    } catch (e) {
      if (usedWebCodecs && !forceJpeg && !cancelled) {
        throw new WebCodecsOutputError(e);
      }
      throw e;
    } finally {
      // 还原引擎（同 playTrip 结束）
      engine.clearTraveled();
      engine.hideVehicle();
      engine.setRoutesVisible(true);
      engine.setProjection("mercator");
      engine.setAutoProjection(true);
      yieldChannel?.port1.close();
      yieldChannel?.port2.close();
      if (cancelled && session) {
        fetch(`/api/recordings/frames?session=${session}`, { method: "DELETE" }).catch(() => {});
      }
    }
  };

  const done = run(false).catch((e) => {
    if (!cancelled && e instanceof WebCodecsOutputError) {
      console.warn("[travel-story] WebCodecs 输出未通过校验，改用 JPEG + FFmpeg 重试", e);
      return run(true);
    }
    throw e;
  });

  return {
    cancel: () => {
      cancelled = true;
    },
    done,
  };
}

// ------------------------------------------------------------
// 通道 C：WebCodecs 软件 H.264 编码
// ------------------------------------------------------------

/** 探测 WebCodecs H.264 软件编码
 * （仍比 JPEG 通道少一次帧图片上传与服务端二次编码）；
 * 都不支持返回 null，回退 JPEG 帧序列通道 */
async function pickEncoderConfig(
  width: number,
  height: number,
  fps: number
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined") return null;
  const base = {
    codec: "avc1.64002A", // H.264 High L4.2：1080p60 横竖屏同级别，720p/30fps 向下兼容
    width,
    height,
    framerate: fps,
    // 码率随像素量等比缩放（720P 约 7 Mbps）
    bitrate: Math.round((HW_BITRATE_1080P * width * height) / (1920 * 1080)),
    latencyMode: "quality",
    avc: { format: "avc" }, // 交给 mp4-muxer，需要 avcC description
  };
  const candidates: VideoEncoderConfig[] = [
    { ...base, hardwareAcceleration: "prefer-software" } as VideoEncoderConfig,
  ];
  for (const c of candidates) {
    try {
      const res = await VideoEncoder.isConfigSupported(c);
      if (res.supported) return c;
    } catch {
      /* 继续试下一个 */
    }
  }
  return null;
}

function createWebCodecsSink(
  config: VideoEncoderConfig,
  width: number,
  height: number,
  fps: number,
  tripName: string
): FrameSink {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: fps },
    // 全部在内存里攒，faststart 元数据前置，上传即成品
    fastStart: "in-memory",
  });
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });
  encoder.configure(config);

  return {
    async addFrame(idx, canvas) {
      if (encoderError) throw encoderError;
      // 背压：编码队列堵了就等出队，不阻塞渲染主循环以外的东西
      while (encoder.encodeQueueSize > IN_FLIGHT) {
        await new Promise<void>((r) =>
          encoder.addEventListener("dequeue", () => r(), { once: true })
        );
      }
      // VideoFrame 是 GPU 侧零拷贝，不做像素回读；静态帧画布没变，照喂即可
      const vf = new VideoFrame(canvas, {
        timestamp: Math.round((idx * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(vf, { keyFrame: idx % (fps * 2) === 0 }); // 2s 一个关键帧
      vf.close();
    },
    async finalize() {
      await encoder.flush();
      encoder.close();
      if (encoderError) throw encoderError;
      muxer.finalize();
      const res = await fetch(
        `/api/recordings?trip=${encodeURIComponent(tripName)}&ext=mp4`,
        {
          method: "POST",
          headers: { "Content-Type": "video/mp4" },
          body: muxer.target.buffer,
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json as OfflineRenderResult;
    },
    dispose() {
      try {
        encoder.close();
      } catch {
        /* 已关闭 */
      }
    },
  };
}

// ------------------------------------------------------------
// 通道 A+B：JPEG 帧序列（兜底；编码与上传全部后台并行）
// ------------------------------------------------------------

function createJpegSink(session: string, tripName: string, fps: number): FrameSink {
  /** 每批上传的帧数（约 1 秒视频） */
  const BATCH = fps;
  let batch: { idx: number; blob: Blob }[] = [];
  const encoding = new Set<Promise<unknown>>();
  const uploads = new Set<Promise<unknown>>();
  /** 每一帧的 JPEG  promise：复用帧要等它前面的实渲帧出图 */
  const blobOf = new Map<number, Promise<Blob>>();
  let lastRendered = -1;

  const track = (set: Set<Promise<unknown>>, p: Promise<unknown>) => {
    set.add(p);
    p.catch(() => {}); // 拒绝统一在 finalize 的 allSettled 里收口，这里防 unhandled
    p.finally(() => set.delete(p));
  };

  const flushBatch = () => {
    if (!batch.length) return;
    const fd = new FormData();
    for (const f of batch) {
      fd.append("frames", f.blob, `${String(f.idx).padStart(6, "0")}.jpg`);
    }
    batch = [];
    const up = fetch(`/api/recordings/frames?session=${session}`, {
      method: "POST",
      body: fd,
    }).then((res) => {
      if (!res.ok) throw new Error(`帧上传失败 HTTP ${res.status}`);
    });
    track(uploads, up);
  };

  return {
    async addFrame(idx, canvas, reuse) {
      if (reuse && lastRendered >= 0) {
        // 静态帧：复用前一实渲帧的 JPEG（还没编出来就等它一下）
        const pb = blobOf.get(lastRendered);
        if (!pb) throw new Error("内部错误：缺上一帧");
        batch.push({ idx, blob: await pb });
        if (batch.length >= BATCH) flushBatch();
        return;
      }
      lastRendered = idx;
      // toBlob 调用即快照画布（规范行为），之后的重绘不会污染在飞编码
      const p = new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("帧编码失败"))),
          "image/jpeg",
          JPEG_Q
        );
      });
      blobOf.set(idx, p);
      track(encoding, p);
      p.then((blob) => {
        batch.push({ idx, blob });
        if (batch.length >= BATCH) flushBatch();
      }, () => {});
      // 在飞编码超上限才等一下，平时渲染不等编码
      while (encoding.size >= IN_FLIGHT) {
        await Promise.race(encoding);
      }
    },
    async finalize() {
      const settled = await Promise.allSettled([...encoding]);
      for (const s of settled) {
        if (s.status === "rejected") throw s.reason;
      }
      flushBatch();
      const upSettled = await Promise.allSettled([...uploads]);
      for (const s of upSettled) {
        if (s.status === "rejected") throw s.reason;
      }
      const res = await fetch(
        `/api/recordings/frames?session=${session}&finalize=1&trip=${encodeURIComponent(tripName)}&fps=${fps}`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json as OfflineRenderResult;
    },
    dispose() {
      // 帧文件清理由 renderOffline 的 finally 发 DELETE 统一处理
    },
  };
}

// ------------------------------------------------------------
// 帧驱动与静态帧判定
// ------------------------------------------------------------

/** 该帧与上一帧是否完全相同：镜头静止 ≥150ms、无载具、无动态素材、瓦片就绪 */
function canReuseFrame(
  map: MapInstance,
  tl: Timeline,
  compositor: Compositor,
  tMs: number,
  currentShotStart: number
): boolean {
  // 镜头边界刚过（字幕/高亮刚换）→ 画面不同
  if (currentShotStart > tMs - STATIC_HOLD_MS) return false;
  const a = tl.cameraAt(tMs);
  const b = tl.cameraAt(tMs - STATIC_HOLD_MS);
  if (
    a.center[0] !== b.center[0] ||
    a.center[1] !== b.center[1] ||
    a.zoom !== b.zoom ||
    a.bearing !== b.bearing ||
    a.pitch !== b.pitch
  ) {
    return false;
  }
  if (tl.vehicleAt(tMs) || tl.vehicleAt(tMs - STATIC_HOLD_MS)) return false;
  if (tl.projectionAt(tMs) !== tl.projectionAt(tMs - STATIC_HOLD_MS)) return false;
  if (!compositor.isStaticFrame(tMs) || !compositor.isStaticFrame(tMs - STATIC_HOLD_MS)) {
    return false;
  }
  // 瓦片还在加载（含淡入动画）→ 画面还在变
  return map.loaded();
}

/** 把虚拟时刻的相机/载具/已行驶/投影一次性摆到位 */
function applyFrame(
  map: MapInstance,
  engine: TravelMapEngine,
  tl: Timeline,
  tMs: number
) {
  engine.setProjection(tl.projectionAt(tMs));
  const cam = tl.cameraAt(tMs);
  map.jumpTo({
    center: engine.toMap(cam.center),
    zoom: cam.zoom,
    bearing: cam.bearing,
    pitch: cam.pitch,
  });
  const v = tl.vehicleAt(tMs);
  if (v) {
    const frame = (Math.floor(tMs / VEHICLE_FRAME_MS) % 2) as 0 | 1;
    engine.setVehicle(
      v.point,
      v.heading,
      v.transport,
      frame,
      v.distM != null ? formatDistance(v.distM) : ""
    );
  } else {
    engine.hideVehicle();
  }
  const traveled = tl.traveledAt(tMs);
  // null 也是有效状态：该帧不应显示任何红线（如章节卡/新的一天），清掉
  if (traveled) engine.setTraveled(traveled);
  else engine.clearTraveled();
}
