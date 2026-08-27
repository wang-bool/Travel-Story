"use client";

// ============================================================
// Travel Story — 场记字幕 / 行程点标记的 canvas 渲染器（共享层）
//
// 播放页（透明覆盖层）与纪录片录制（合成器）共用这一份实现，
// 保证「演示什么样，成片就什么样」。设计基准沿用播放页 DOM 版场记：
//   - 左下角排版：kicker 深色胶囊 + Fraunces 大标题 + mono 小字副标；
//   - 章节卡：暗色蒙板压全场，DAY 居中，两端 320ms 淡入淡出；
//   - 段场记：A —载具→ B（载具卡通插画嵌在箭头正中，摆动动画）。
// 素材展示与片尾字幕是录制专属，仍由合成器自己画。
//
// 布局在虚拟坐标系里进行（高 720，宽随画幅），调用方负责把 ctx
// 变换到实际画布尺寸。
// ============================================================

import { formatDateCN } from "@/lib/store";
import { formatDistance } from "@/lib/routing";
import { iconDataUrl, vehicleIconSvg } from "@/lib/mapIcons";
import { TRANSPORT_META } from "@/lib/types";
import type { Transport, Trip } from "@/lib/types";
import { DAY_CARD_MS, type PlaybackShot } from "./playback";

/** 虚拟布局高度（宽 = 高 × 画幅比例，由调用方给出） */
export const CAPTION_VIEW_BASE = 720;

/** 一帧的虚拟画幅 */
export interface CaptionView {
  w: number;
  h: number;
  portrait: boolean;
}

/** 经纬度 → 虚拟画布坐标（播放页=容器直投，录制=cover 变换）；返回 null 不画 */
export type CaptionProject = (lng: number, lat: number) => { x: number; y: number } | null;

export interface CaptionRenderer {
  /** 字幕字体与本行程载具插画就绪后才可开画 */
  ready: Promise<void>;
  /** 播放编排器每进入一个镜头调用一次；at 缺省取墙钟 */
  updateShot(shot: PlaybackShot, at?: number): void;
  /** 当前镜头与进入时刻（合成器的素材排期要按它走） */
  shotState(): { shot: PlaybackShot; startedAt: number } | null;
  /** 行程点标记：墨点 + 名称，当前特写点朱砂红高亮，非当天的点淡化 */
  drawStops(ctx: CanvasRenderingContext2D, view: CaptionView, project: CaptionProject): void;
  /** 影院暗角 */
  drawVignette(ctx: CanvasRenderingContext2D, view: CaptionView): void;
  /** 当前镜头的场记字幕（intro/stop/day/segment）；无镜头不画 */
  drawSlate(ctx: CanvasRenderingContext2D, view: CaptionView, now: number): void;
}

const INK = "#26211A";
const PAPER = "#F6F1E4";
const ACCENT = "#E4572E";
/** 场记左边距/下边距（虚拟像素） */
const SLATE_MARGIN = 48;
/** 章节卡蒙板淡入淡出时长（与播放页旧 DOM 版 CSS 动画一致） */
const DAY_FADE_MS = 320;

export function createCaptionRenderer(trip: Trip): CaptionRenderer {
  let current: { shot: PlaybackShot; startedAt: number } | null = null;
  /** 段场记「A —载具→ B」用的载具插画：本行程用到的交通方式各备一张 */
  const vehicleIcons = new Map<Transport, HTMLImageElement>();

  const ready = (async () => {
    await Promise.all([
      // 字幕字体就绪再开画，否则开头几秒是系统字体
      document.fonts.load('600 64px "Fraunces"'),
      document.fonts.load('700 13px "Space Mono"'),
      // 载具插画（本行程用到的交通方式）
      ...[...new Set(trip.segments.map((s) => s.transport))].map(async (t) => {
        const img = new Image();
        img.src = iconDataUrl(vehicleIconSvg(t, 0));
        try {
          await img.decode();
          vehicleIcons.set(t, img);
        } catch {
          /* 图标缺失就退化为纯文字 */
        }
      }),
    ]);
  })();

  function updateShot(shot: PlaybackShot, at?: number) {
    current = { shot, startedAt: at ?? performance.now() };
  }

  // ------------------------------------------------------------
  // 行程点标记
  // ------------------------------------------------------------

  function drawStops(
    ctx: CanvasRenderingContext2D,
    view: CaptionView,
    project: CaptionProject
  ) {
    const currentStopId =
      current?.shot.type === "stop" ? current.shot.stop?.id : null;
    // 开场（intro）没有 day，全员正常亮度；进入某天后非当天的点淡化
    const shotDay = current?.shot.day ?? null;
    const ordered = [
      ...trip.stops.filter((s) => s.id !== currentStopId),
      ...trip.stops.filter((s) => s.id === currentStopId),
    ];
    ctx.save();
    for (const stop of ordered) {
      const p = project(stop.longitude, stop.latitude);
      if (!p) continue;
      const { x, y } = p;
      if (x < -40 || x > view.w + 40 || y < -40 || y > view.h + 40) continue;
      const isCurrent = stop.id === currentStopId;
      const dimmed = shotDay != null && stop.day !== shotDay && !isCurrent;
      ctx.globalAlpha = dimmed ? 0.35 : 1;
      // 点
      const r = isCurrent ? 9 : 6;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? ACCENT : INK;
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.stroke();
      // 名称（当前点大字，其余小字）：加粗 + 深色描边光晕，
      // 压在复杂地图上、经视频压缩后也清晰可读。
      // 成片按 1280/1920 宽回放，字号要再大一号才看得清「从哪到哪」
      ctx.font = isCurrent
        ? '700 24px "Space Mono", monospace'
        : '600 18px "Space Mono", monospace';
      ctx.lineJoin = "round";
      ctx.strokeStyle = dimmed ? "rgba(15,13,10,0.55)" : "rgba(15,13,10,0.9)";
      ctx.lineWidth = isCurrent ? 5.5 : 4;
      const tx = x + r + 7;
      const ty = y + (isCurrent ? 8 : 6);
      ctx.strokeText(stop.name, tx, ty);
      ctx.fillStyle = PAPER;
      ctx.fillText(stop.name, tx, ty);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------
  // 影院暗角
  // ------------------------------------------------------------

  // 暗角预渲染成离屏图：渐变只建一次，每帧改成一次 drawImage blit。
  // 渐变与旧实现逐像素一致（同一参数、同一离屏画布绘制序列）。
  let vignette: { w: number; h: number; canvas: HTMLCanvasElement } | null = null;

  function drawVignette(ctx: CanvasRenderingContext2D, view: CaptionView) {
    if (!vignette || vignette.w !== view.w || vignette.h !== view.h) {
      const c = document.createElement("canvas");
      c.width = view.w;
      c.height = view.h;
      const cctx = c.getContext("2d")!;
      const vg = cctx.createRadialGradient(
        view.w / 2, view.h / 2, view.h * 0.36,
        view.w / 2, view.h / 2, view.h * 0.95
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.5)");
      cctx.fillStyle = vg;
      cctx.fillRect(0, 0, view.w, view.h);
      vignette = { w: view.w, h: view.h, canvas: c };
    }
    ctx.drawImage(vignette.canvas, 0, 0);
  }

  // ------------------------------------------------------------
  // 场记字幕
  // ------------------------------------------------------------

  // 字号排版缓存：字号在镜头内恒定（只有载具动画随时间变），
  // 每帧重复 measureText 量宽（文本整形是 canvas 里最贵的操作之一）纯属浪费。
  // 结果只依赖 (镜头文本, 画幅)，与时间无关，缓存逐像素等价。
  let slateLayout: { key: string; size: number } | null = null;
  function cachedSlateSize(key: string, compute: () => number): number {
    if (!slateLayout || slateLayout.key !== key) {
      slateLayout = { key, size: compute() };
    }
    return slateLayout.size;
  }

  function drawSlate(ctx: CanvasRenderingContext2D, view: CaptionView, now: number) {
    const shot = current?.shot;
    if (!shot) return;
    let kicker = "";
    let title = "";
    let sub = "";
    if (shot.type === "intro") {
      kicker = "A TRAVEL STORY";
      title = trip.name;
      sub = (trip.region ?? "").toUpperCase() || "YOUR JOURNEY";
    } else if (shot.type === "day") {
      // 章节卡单独排版：暗色蒙板压全场，DAY 居中
      drawDayCard(ctx, view, shot, now);
      return;
    } else if (shot.type === "stop" && shot.stop) {
      kicker = `DAY ${String(shot.day ?? 0).padStart(2, "0")} · ${(
        shot.stop.city || trip.region || ""
      ).toUpperCase()}`;
      title = shot.stop.name;
    } else if (shot.type === "segment" && shot.segment) {
      // 段场记单独排版：A —载具→ B
      drawSegRoute(ctx, view, shot, now);
      return;
    } else {
      return;
    }

    // 长标题自动降字号（竖屏整体降一档），再按实测宽度微降，防止溢出屏幕
    // （字号按镜头缓存，避免每帧重复 measureText 量宽）
    const titleSize = cachedSlateSize(
      `slate:${shot.type}:${shot.index}:${title}`,
      () => {
        let s = title.length > 18 ? 40 : title.length > 12 ? 48 : 64;
        if (view.portrait) s = Math.min(s, title.length > 18 ? 32 : 48);
        ctx.font = `600 ${s}px "Fraunces", "Songti SC", serif`;
        while (s > 26 && ctx.measureText(title).width > view.w - SLATE_MARGIN * 2) {
          s -= 2;
          ctx.font = `600 ${s}px "Fraunces", "Songti SC", serif`;
        }
        return s;
      }
    );
    ctx.font = `600 ${titleSize}px "Fraunces", "Songti SC", serif`;
    const x = SLATE_MARGIN;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = PAPER;

    // 从下往上排：sub → 标题 → kicker（kicker 要抬到标题顶上方）
    let y = view.h - SLATE_MARGIN;
    if (sub) {
      ctx.font = '700 15px "Space Mono", monospace';
      ctx.globalAlpha = 0.82;
      ctx.fillText(sub, x, y);
      y -= 30;
    }
    ctx.globalAlpha = 1;
    ctx.font = `600 ${titleSize}px "Fraunces", "Songti SC", serif`;
    ctx.fillText(title, x, y);
    ctx.restore();
    drawKicker(ctx, kicker, x, y - (titleSize + 18));
  }

  /** kicker 深色胶囊（沿用播放页 DOM 版样式：圆角 7、墨底 68%） */
  function drawKicker(ctx: CanvasRenderingContext2D, text: string, x: number, baseline: number) {
    ctx.save();
    ctx.font = '700 13px "Space Mono", monospace';
    const w = ctx.measureText(text).width;
    const padX = 10;
    const top = baseline - 13 - 7;
    ctx.fillStyle = "rgba(15,13,10,0.68)";
    ctx.beginPath();
    ctx.roundRect(x, top, w + padX * 2 + 4, 28, 7);
    ctx.fill();
    ctx.fillStyle = "#FFFDF7";
    ctx.fillText(text, x + padX + 2, baseline);
    ctx.restore();
  }

  /** 章节卡：暗色蒙板压全场（遮个七七八八），DAY 居中，淡入淡出 */
  function drawDayCard(
    ctx: CanvasRenderingContext2D,
    view: CaptionView,
    shot: PlaybackShot,
    now: number
  ) {
    const tIn = now - (current?.startedAt ?? now);
    const a = Math.max(0, Math.min(1, tIn / DAY_FADE_MS, (DAY_CARD_MS - tIn) / DAY_FADE_MS));
    if (a <= 0) return;
    const d = trip.days.find((x) => x.day === shot.day);
    ctx.save();
    ctx.globalAlpha = a * 0.78;
    ctx.fillStyle = "#0F0D0A";
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.fillStyle = PAPER;
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 16;
    ctx.globalAlpha = a;
    ctx.font = '700 15px "Space Mono", monospace';
    ctx.fillText(d?.date ? formatDateCN(d.date) : trip.name, view.w / 2, view.h / 2 - 96);
    ctx.globalAlpha = a;
    ctx.font = '600 96px "Fraunces", "Songti SC", serif';
    ctx.fillText(`DAY ${String(shot.day ?? 1).padStart(2, "0")}`, view.w / 2, view.h / 2 + 24);
    ctx.restore();
  }

  /** 段场记：A —载具→ B。载具卡通大图标嵌在箭头正中，两端是地名；
   *  图标随时间上下抖动 + 左右摆动（now 由调用方给，离线渲染同样确定） */
  function drawSegRoute(
    ctx: CanvasRenderingContext2D,
    view: CaptionView,
    shot: PlaybackShot,
    now: number
  ) {
    const seg = shot.segment!;
    const transport = seg.transport;
    const from = shot.stop?.name ?? "";
    const to = shot.nextStop?.name ?? "NEXT STOP";
    const y = view.h - SLATE_MARGIN;
    // 箭头区宽随字号走：内边距 16×2 + 两侧线段 + 载具图标。
    // 由字号推导宽度，图标永远压不到后面的「—→」（竖屏窄画布同理）
    const gap = view.portrait ? 18 : 26; // 图标两侧线段长
    const iconWFor = (s: number) => s * 1.9;
    const arrowWFor = (s: number) => 32 + gap * 2 + iconWFor(s);

    // 自适应字号：量总宽，超宽就降档（竖屏画布窄，下限放更低）。
    // 字号按镜头缓存，避免每帧重复 measureText 量宽（结果只依赖地名与画幅）
    const size = cachedSlateSize(
      `seg:${shot.index}:${from}:${to}:${transport}:${view.portrait}`,
      () => {
        let s = view.portrait ? 40 : 48;
        const totalWidth = (v: number) => {
          ctx.font = `600 ${v}px "Fraunces", "Songti SC", serif`;
          return ctx.measureText(from).width + ctx.measureText(to).width + arrowWFor(v);
        };
        while (s > (view.portrait ? 20 : 28) && totalWidth(s) > view.w - SLATE_MARGIN * 2) s -= 4;
        return s;
      }
    );
    const arrowW = arrowWFor(size);

    ctx.save();
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = PAPER;
    ctx.font = `600 ${size}px "Fraunces", "Songti SC", serif`;

    let x = SLATE_MARGIN;
    ctx.fillText(from, x, y);
    x += ctx.measureText(from).width;

    // 箭头区：短线 → 载具大图标 → 短线 + 箭头尖
    const cy = y - size * 0.32; // 文字视觉中线
    const ax0 = x + 16;
    const ax1 = x + arrowW - 16;
    const iconW = iconWFor(size);
    const iconH = iconW / 1.5; // 载具插画原生 120×80
    ctx.strokeStyle = "rgba(246,241,228,0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ax0, cy);
    ctx.lineTo(ax0 + gap, cy);
    ctx.stroke();
    const icon = vehicleIcons.get(transport);
    if (icon) {
      // 上下抖动 + 左右摆动（时间正弦，离线逐帧也是确定性动画）
      const bob = Math.sin(now / 260) * 4;
      const sway = Math.sin(now / 430) * 3;
      ctx.drawImage(icon, ax0 + gap + sway, cy - iconH * 0.72 + bob, iconW, iconH);
    }
    const rx = ax1 - gap;
    ctx.beginPath();
    ctx.moveTo(rx, cy);
    ctx.lineTo(ax1, cy);
    ctx.moveTo(ax1, cy);
    ctx.lineTo(ax1 - 11, cy - 7);
    ctx.moveTo(ax1, cy);
    ctx.lineTo(ax1 - 11, cy + 7);
    ctx.stroke();
    x += arrowW;

    ctx.fillText(to, x, y);
    ctx.restore();

    // kicker：交通方式 + 总里程（沿用播放页 DOM 版「NEXT STOP · 高铁 · 128 km」）
    const dist = seg.distance;
    const kicker =
      dist != null && dist > 0
        ? `NEXT STOP · ${TRANSPORT_META[transport].label} · ${formatDistance(dist)}`
        : `NEXT STOP · ${TRANSPORT_META[transport].label}`;
    drawKicker(ctx, kicker, SLATE_MARGIN, y - (size + 18));
  }

  return {
    ready,
    updateShot,
    shotState: () => current,
    drawStops,
    drawVignette,
    drawSlate,
  };
}
