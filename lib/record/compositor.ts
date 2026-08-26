"use client";

// ============================================================
// Travel Story — 纪录片合成器（Compositor）
//
// 把「播放编排器驱动的地图画面 + 行程点标记 + 场记字幕 + 素材」
// 逐帧画到输出画布上，供录制成真视频。输出规格可选：
// 画幅 横屏 16:9（B 站式）/ 竖屏 9:16（手机），清晰度 1080P / 720P。
//
// 结构与播放页一致：开场 →（地点特写 → 该地点素材展示）× N → 片尾。
// 用户上传的图片/视频是这个地点的回忆素材：镜头飞抵（约 2.2s）后先
// 停留 1.6s 让观众看清是哪个景点，然后素材淡入依次播放（图片 2.6s，
// 视频按原长、上限 15s）；素材 contain 完整显示，比例不符处黑底遮幅。
//
// 两种驱动方式：
//   - 实时（offline=false）：captureStream(60) 灌进 <video> 再 drawImage，
//     走 GPU 侧拷贝，与地图渲染解耦，rAF 锁 60fps 逐帧绘制；
//   - 离线（offline=true）：不碰 captureStream，由渲染泵按虚拟时钟
//     调 renderFrame(tMs)，地图画布直读（页面对 preserveDrawingBuffer），
//     视频素材逐帧 seek，帧间隔严格相等，绝不掉帧。
// ============================================================

import { mediaUrl } from "@/lib/media";
import type { MediaMeta, Trip, TripStop } from "@/lib/types";
import type { TravelMapEngine } from "@/lib/map/engine";
import { DAY_CARD_MS, type PlaybackShot } from "@/lib/map/playback";
import { createCaptionRenderer, type CaptionView } from "@/lib/map/captions";

/** 输出视频规格：横屏（16:9，B 站/电脑）与竖屏（9:16，手机短视频） */
export type VideoFormat = "landscape" | "portrait";
/** 清晰度档位：1080P / 720P。720P 配合更低的地图 pixelRatio，渲染快约一倍 */
export type VideoQuality = "1080" | "720";
/** 流畅度档位：60fps 最丝滑，30fps 帧数减半、渲染快一倍 */
export type VideoFps = 60 | 30;

export const VIDEO_FORMATS: Record<VideoFormat, { label: string; hint: string }> = {
  landscape: { label: "横屏 16:9", hint: "适合电脑 / B 站" },
  portrait: { label: "竖屏 9:16", hint: "适合手机" },
};

/** 画幅 + 清晰度 → 输出像素尺寸（长边 1920 / 1280） */
export function videoSpec(
  format: VideoFormat,
  quality: VideoQuality
): { w: number; h: number } {
  const long = quality === "720" ? 1280 : 1920;
  const short = (long * 9) / 16;
  return format === "portrait" ? { w: short, h: long } : { w: long, h: short };
}

/** 地图画布的 pixelRatio：要盖过输出高度才不继虚化；清晰度低时可以降，
 *  地图每帧渲染像素随之减少——720P 的提速主要来自这里 */
export function mapPixelRatioFor(format: VideoFormat, quality: VideoQuality): number {
  if (format === "portrait") return quality === "720" ? 1.5 : 2.2;
  return quality === "720" ? 1 : 1.5;
}

/** 实时播放/录制的合成帧率（离线渲染帧率由渲染泵的 fps 参数决定） */
export const FPS = 60;

/** 布局按 1280×720（竖屏 720×1280）虚拟坐标设计，逐帧经 ctx 变换
 *  整体放大到输出尺寸，字号/边距/标记大小不用逐个改 */
const VIEW_BASE = 720;

/** 素材上屏前的纯地图镜头：飞抵约 2.2s + 落定后 1.6s，先看清是哪个景点 */
const MEDIA_LEAD_MS = 3800;
const IMAGE_MS = 2600;
const VIDEO_CAP_MS = 15000;
/** 无素材地点的停留时长 */
const PLAIN_DWELL_MS = 2200;
/** 素材淡入时长 */
const MEDIA_FADE_MS = 320;
/** 最后一份素材播完后的淡出时长（对应 dwellMs 里的 +400ms 尾部） */
const MEDIA_OUT_FADE_MS = 400;

interface PreparedMedia {
  meta: MediaMeta;
  el: HTMLImageElement | HTMLVideoElement;
  /** 这一份素材占用的时长（含视频尾部缓冲） */
  slotMs: number;
}

interface CurrentShot {
  shot: PlaybackShot;
  startedAt: number;
}

export interface Compositor {
  canvas: HTMLCanvasElement;
  /** 等素材预载完成（图片解码、视频元数据）后才可开录 */
  ready: Promise<void>;
  /** 该地点特写应停留多久（播放编排器/时间轴用） */
  dwellMs(stop: TripStop): number;
  /** 播放编排器每进入一个镜头调用一次；at 传虚拟时刻（离线），缺省取墙钟 */
  updateShot(shot: PlaybackShot, at?: number): void;
  /** 片尾字幕（播放结束后调用，再录几秒收尾画面） */
  showOutro(at?: number): void;
  /** 离线渲染：把虚拟时刻 now 的这一帧画到输出画布（视频素材逐帧 seek） */
  renderFrame(now: number): Promise<void>;
  /** 该帧画面是否与静止时完全相同（静态帧去重用）：视频素材、素材淡入、片尾渐显期间返回 false */
  isStaticFrame(now: number): boolean;
  start(): void;
  stop(): void;
}

export function createCompositor({
  engine,
  trip,
  offline = false,
  format = "landscape",
  quality = "1080",
  fps = FPS,
}: {
  engine: TravelMapEngine;
  trip: Trip;
  /** 离线逐帧渲染模式：不开 captureStream，由渲染泵调 renderFrame */
  offline?: boolean;
  /** 输出画幅：横屏 16:9 / 竖屏 9:16 */
  format?: VideoFormat;
  /** 清晰度档位：1080P / 720P */
  quality?: VideoQuality;
  /** 实时模式的合成/采集帧率（离线模式不用） */
  fps?: number;
}): Compositor {
  const spec = videoSpec(format, quality);
  const canvas = document.createElement("canvas");
  canvas.width = spec.w;
  canvas.height = spec.h;
  const ctx = canvas.getContext("2d")!;

  // 虚拟布局坐标系：横屏 1280×720，竖屏 720×1280
  const PORTRAIT = spec.h > spec.w;
  const VIEW_W = PORTRAIT ? VIEW_BASE : spec.w / (spec.h / VIEW_BASE);
  const VIEW_H = PORTRAIT ? spec.h / (spec.w / VIEW_BASE) : VIEW_BASE;
  const VIEW_SCALE = spec.w / VIEW_W;

  const mediaPlan = new Map<string, PreparedMedia[]>();
  let current: CurrentShot | null = null;
  let activeVideo: HTMLVideoElement | null = null;
  let outroAt = 0;
  let raf = 0;
  let lastDraw = 0;
  const stopHooks: (() => void)[] = [];

  // ---- 地图画面：实时模式走 captureStream → <video>，避免每帧 GPU 回读卡顿；
  //      离线模式由渲染泵等完地图 render 后直读画布（preserveDrawingBuffer）----
  const mapCanvas = engine.map.getCanvas();
  let mapSource: HTMLCanvasElement | HTMLVideoElement = mapCanvas;
  if (!offline) {
    const mapVideo = document.createElement("video");
    mapVideo.muted = true;
    mapVideo.playsInline = true;
    try {
      mapVideo.srcObject = mapCanvas.captureStream(fps);
      mapVideo.play().then(() => {
        mapSource = mapVideo;
      }).catch(() => {});
    } catch {
      mapSource = mapCanvas; // 老内核兜底：直接读画布
    }
    // 挂到 stop 作用域：stop() 时清理
    stopHooks.push(() => {
      mapVideo.pause();
      mapVideo.srcObject = null;
    });
  }

  // ---- 预载：字幕渲染器（字体 + 载具插画）→ 图片 decode、视频读元数据拿时长 ----
  // 场记字幕/行程点标记与播放页共用同一渲染器（lib/map/captions.ts），
  // 演示什么样，成片就什么样
  const captions = createCaptionRenderer(trip);
  const ready = (async () => {
    await captions.ready;
    await Promise.all(
      trip.stops.map(async (stop) => {
        const list = stop.media ?? [];
        if (!list.length) return;
        const prepared = await Promise.all(list.map(prepare));
        mediaPlan.set(
          stop.id,
          prepared.filter((p): p is PreparedMedia => !!p)
        );
      })
    );
  })();

  async function prepare(meta: MediaMeta): Promise<PreparedMedia | null> {
    const url = mediaUrl(meta.id);
    try {
      if (meta.kind === "image") {
        const img = new Image();
        img.src = url;
        await img.decode();
        return { meta, el: img, slotMs: IMAGE_MS };
      }
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      await new Promise<void>((r) => {
        video.onloadedmetadata = () => r();
        video.onerror = () => r();
      });
      const durMs = Number.isFinite(video.duration) ? video.duration * 1000 : 5000;
      return { meta, el: video, slotMs: Math.min(durMs, VIDEO_CAP_MS) + 500 };
    } catch {
      return null;
    }
  }

  function dwellMs(stop: TripStop): number {
    const plan = mediaPlan.get(stop.id);
    if (!plan?.length) return PLAIN_DWELL_MS;
    return MEDIA_LEAD_MS + plan.reduce((a, p) => a + p.slotMs, 0) + 400;
  }

  function updateShot(shot: PlaybackShot, at?: number) {
    current = { shot, startedAt: at ?? performance.now() };
    captions.updateShot(shot, at);
    // 切镜头时停掉上一个视频
    if (activeVideo) {
      activeVideo.pause();
      activeVideo = null;
    }
  }

  function showOutro(at?: number) {
    outroAt = at ?? performance.now();
    if (activeVideo) {
      activeVideo.pause();
      activeVideo = null;
    }
  }

  interface ActiveMedia {
    item: PreparedMedia;
    /** 在这一份素材内部的时间（含淡入） */
    tIn: number;
    idx: number;
    total: number;
    /** 非空 = 素材全部播完后的尾部淡出：剩余不透明度 1→0 */
    fadeOut?: number;
  }

  /** 当前时刻应展示的素材（含片内位置/进度），无则 null */
  function activeMedia(now: number): ActiveMedia | null {
    if (!current || current.shot.type !== "stop" || !current.shot.stop) return null;
    const plan = mediaPlan.get(current.shot.stop.id);
    if (!plan?.length) return null;
    let t = now - current.startedAt - MEDIA_LEAD_MS;
    if (t < 0) return null;
    for (let i = 0; i < plan.length; i++) {
      if (t < plan[i].slotMs) return { item: plan[i], tIn: t, idx: i, total: plan.length };
      t -= plan[i].slotMs;
    }
    // 尾部淡出：最后一份素材淡回地图，避免硬切漏地图
    if (t < MEDIA_OUT_FADE_MS) {
      const last = plan[plan.length - 1];
      return {
        item: last,
        tIn: last.slotMs,
        idx: plan.length - 1,
        total: plan.length,
        fadeOut: 1 - t / MEDIA_OUT_FADE_MS,
      };
    }
    return null;
  }

  /** 离线渲染一帧：视频素材先 seek 到这一帧的精确位置，再绘制 */
  async function renderFrame(now: number) {
    const media = activeMedia(now);
    if (media && media.item.meta.kind === "video") {
      await seekVideo(media.item.el as HTMLVideoElement, media.tIn / 1000);
    }
    draw(now);
  }

  /** 视频逐帧定位：偏差 <40ms 不重复 seek；超出片长的尾部缓冲段停在最后一帧 */
  async function seekVideo(v: HTMLVideoElement, targetSec: number) {
    const dur = Number.isFinite(v.duration) ? v.duration : targetSec;
    const target = Math.min(targetSec, Math.max(0, dur - 0.05));
    if (Math.abs(v.currentTime - target) < 0.04) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 400); // 兜底：丢帧也比卡死强
      v.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
      v.currentTime = target;
    });
  }

  /** 静态帧判定：视频素材在播、素材淡入/淡出中、片尾渐显中的帧不可复用 */
  function isStaticFrame(now: number): boolean {
    if (current?.shot.type === "segment") return false; // 段场记载具图标有摆动动画
    if (current?.shot.type === "day") {
      const tIn = now - current.startedAt;
      if (tIn < 320 || DAY_CARD_MS - tIn < 320) return false; // 蒙板淡入淡出中
    }
    const media = activeMedia(now);
    if (media) {
      if (media.fadeOut != null) return false;
      if (media.item.meta.kind === "video") return false;
      if (media.tIn < MEDIA_FADE_MS) return false;
    }
    if (outroAt && now - outroAt < 700) return false;
    return true;
  }

  // ------------------------------------------------------------
  // 逐帧绘制（全部在虚拟坐标系里，draw 开头统一放大到输出尺寸）
  // ------------------------------------------------------------

  /** 地图画布（CSS 像素）→ 输出画布的 cover 变换参数 */
  function coverTransform() {
    const src = mapSource;
    const sw = src instanceof HTMLVideoElement ? src.videoWidth || 1280 : src.width;
    const sh = src instanceof HTMLVideoElement ? src.videoHeight || 720 : src.height;
    const scale = Math.max(VIEW_W / sw, VIEW_H / sh);
    return { sw, sh, scale, offX: (VIEW_W - sw * scale) / 2, offY: (VIEW_H - sh * scale) / 2 };
  }

  // 虚拟画幅（字幕渲染器用）
  const captionView: CaptionView = { w: VIEW_W, h: VIEW_H, portrait: PORTRAIT };

  function draw(now: number) {
    // 输出画布：把虚拟布局坐标系整体放大
    ctx.setTransform(VIEW_SCALE, 0, 0, VIEW_SCALE, 0, 0);

    // 1. 地图画面（cover 裁切到输出画幅）
    const t = coverTransform();
    if (t.sw > 0 && t.sh > 0) {
      ctx.drawImage(mapSource, t.offX, t.offY, t.sw * t.scale, t.sh * t.scale);
    }

    // 2. 行程点标记（DOM 地标层不会被录进画布，这里画进视频）：
    //    以地图容器的 CSS 尺寸为基准，经 cover 变换投到输出画布
    const container = engine.map.getContainer();
    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    if (cssW && cssH) {
      captions.drawStops(ctx, captionView, (lng, lat) => {
        // Globe 模式下地球背面的点不画（project 会把它们镜像到球面上）
        if (!engine.isOnVisibleHemisphere(lng, lat)) return null;
        const p = engine.project(lng, lat);
        return {
          x: t.offX + (p.x / cssW) * t.sw * t.scale,
          y: t.offY + (p.y / cssH) * t.sh * t.scale,
        };
      });
    }

    // 3. 影院暗角
    captions.drawVignette(ctx, captionView);

    // 4. 素材播放（在场记字幕之上：素材时间地图与字幕都让位）
    const media = activeMedia(now);
    if (media) {
      drawMediaFull(media);
    } else if (outroAt) {
      drawOutro(now);
    } else {
      captions.drawSlate(ctx, captionView, now);
    }
  }

  /** contain 居中绘制一份素材（尺寸未就绪就跳过） */
  function drawContained(el: HTMLImageElement | HTMLVideoElement, kind: MediaMeta["kind"]) {
    const iw = kind === "video"
      ? (el as HTMLVideoElement).videoWidth
      : (el as HTMLImageElement).naturalWidth;
    const ih = kind === "video"
      ? (el as HTMLVideoElement).videoHeight
      : (el as HTMLImageElement).naturalHeight;
    if (!iw || !ih) return;
    const scale = Math.min(VIEW_W / iw, VIEW_H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(el, (VIEW_W - dw) / 2, (VIEW_H - dh) / 2, dw, dh);
  }

  /** 角标：地点名 · 序号 */
  function drawMediaBadge(idx: number, total: number, alpha: number) {
    const stopName = current?.shot.stop?.name ?? "";
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '700 13px "Space Mono", monospace';
    ctx.fillStyle = "rgba(246,241,228,0.92)";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;
    ctx.textAlign = "right";
    ctx.fillText(`${stopName} · ${idx + 1} / ${total}`, VIEW_W - 44, VIEW_H - 40);
    ctx.restore();
  }

  /** 素材播放：黑底遮幅 + contain 完整显示（不裁切）；相邻素材交叉淡化、
   *  播完淡出回地图，任何时刻地图都不会从缝隙里漏出来；右下角标 地点名 · i/N */
  function drawMediaFull(media: ActiveMedia) {
    const { item, tIn, idx, total, fadeOut } = media;
    const el = item.el;

    // 实时模式：视频轮到它时从头播起（离线模式由 renderFrame 逐帧 seek）
    if (!offline && item.meta.kind === "video") {
      const v = el as HTMLVideoElement;
      if (activeVideo !== v) {
        if (activeVideo) activeVideo.pause();
        v.currentTime = 0;
        v.play().catch(() => {});
        activeVideo = v;
      }
    }

    ctx.save();
    if (fadeOut != null) {
      // 尾部淡出：黑底与素材一起淡回地图
      ctx.globalAlpha = fadeOut;
      ctx.fillStyle = "#0F0D0A";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      drawContained(el, item.meta.kind);
      ctx.restore();
      drawMediaBadge(idx, total, fadeOut);
      return;
    }

    // 淡入：首个素材从地图淡入；后续素材黑底常驻，与上一个素材的定格交叉淡化
    const fade = Math.min(1, tIn / MEDIA_FADE_MS);
    const plan = current?.shot.stop ? mediaPlan.get(current.shot.stop.id) : undefined;
    const prev = idx > 0 ? plan?.[idx - 1] : undefined;
    ctx.globalAlpha = idx === 0 ? fade : 1;
    ctx.fillStyle = "#0F0D0A";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (prev && fade < 1) {
      ctx.globalAlpha = 1;
      drawContained(prev.el, prev.meta.kind);
    }
    ctx.globalAlpha = fade;
    drawContained(el, item.meta.kind);
    ctx.restore();
    drawMediaBadge(idx, total, 1);
  }

  /** 片尾：暗场 + 片名 + THE END */
  function drawOutro(now: number) {
    const t = Math.min(1, (now - outroAt) / 700);
    ctx.save();
    ctx.fillStyle = `rgba(15,13,10,${0.82 * t})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = t;
    ctx.fillStyle = "#F6F1E4";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 16;
    ctx.font = '700 14px "Space Mono", monospace';
    ctx.globalAlpha = t * 0.75;
    ctx.fillText("T H E   E N D", VIEW_W / 2, VIEW_H / 2 - 52);
    ctx.globalAlpha = t;
    // 长片名量宽降档，竖屏窄画布也不溢出
    let size = PORTRAIT ? 44 : 56;
    ctx.font = `600 ${size}px "Fraunces", "Songti SC", serif`;
    while (size > 26 && ctx.measureText(trip.name).width > VIEW_W - 96) {
      size -= 2;
      ctx.font = `600 ${size}px "Fraunces", "Songti SC", serif`;
    }
    ctx.fillText(trip.name, VIEW_W / 2, VIEW_H / 2 + 18);
    ctx.restore();
  }

  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    // 锁录制帧率：与输出一致
    if (now - lastDraw < 1000 / fps - 1) return;
    lastDraw = now;
    draw(now);
  }

  return {
    canvas,
    ready,
    dwellMs,
    updateShot,
    showOutro,
    renderFrame,
    isStaticFrame,
    start() {
      if (!raf) {
        lastDraw = 0;
        raf = requestAnimationFrame(loop);
      }
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (activeVideo) {
        activeVideo.pause();
        activeVideo = null;
      }
      for (const h of stopHooks) h();
    },
  };
}
