"use client";

// ============================================================
// Travel Story — 瓦片预热与单帧落位（实时录制 / 离线渲染共用）
//
// 预热：沿时间轴抽约 40 个采样点预飞一遍，让沿线的瓦片与地名
// 字形先进缓存——正式渲染/录制时不再半路等元素。
// ============================================================

import type { Timeline } from "@/lib/map/playback";
import type { TravelMapEngine } from "@/lib/map/engine";

export type MapInstance = TravelMapEngine["map"];

/** 单帧落位：有同步渲染入口就立即出帧（不等屏幕刷新），否则回退到
 *  等 render 事件；瓦片/字形没就绪时小步轮询——idle 事件走 rAF 派发，
 *  会把等待对齐到 16.7ms 的倍数，轮询 + 同步渲染比它快 */
export async function settle(
  map: MapInstance,
  capMs: number,
  syncRender: ((t: number) => void) | null
) {
  if (!syncRender) {
    const rendered = new Promise<void>((r) => map.once("render", () => r()));
    map.triggerRepaint();
    await rendered;
    if (map.loaded()) return;
    await Promise.race([
      new Promise<void>((r) => map.once("idle", () => r())),
      new Promise<void>((r) => setTimeout(r, capMs)),
    ]);
    return;
  }
  syncRender(performance.now());
  const t0 = performance.now();
  while (!map.loaded() && performance.now() - t0 < capMs) {
    // 让出宏任务收瓦片/字形回调（4ms 是浏览器 setTimeout 的最小钳制粒度）
    await new Promise<void>((r) => setTimeout(r, 4));
    syncRender(performance.now());
  }
}

/** 沿时间轴抽约 40 个采样点预飞一遍，让瓦片进缓存 */
export async function prewarmTimeline(
  map: MapInstance,
  engine: TravelMapEngine,
  tl: Timeline,
  syncRender: ((t: number) => void) | null,
  isCancelled: () => boolean
) {
  const step = Math.max(1200, tl.totalMs / 40);
  for (let tMs = 0; tMs < tl.totalMs; tMs += step) {
    if (isCancelled()) return;
    engine.setProjection(tl.projectionAt(tMs));
    const cam = tl.cameraAt(tMs);
    map.jumpTo({
      center: engine.toMap(cam.center),
      zoom: cam.zoom,
      bearing: cam.bearing,
      pitch: cam.pitch,
    });
    await settle(map, 1000, syncRender);
  }
}
