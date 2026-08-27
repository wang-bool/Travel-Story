"use client";

// ============================================================
// Travel Story — 地图画布（React 包装）
//
// 把 TravelMapEngine 挂到 React 树里：
//  - 容器 div 承载 MapLibre canvas；
//  - HTML overlay 层渲染地标标记（SVG 徽章 + 名称 + DAY 标签），
//    通过 engine.project() 把经纬度映射到屏幕像素，随地图平移缩放移动；
//  - 行程变化时同步路线图层；
//  - 通过 onReady 把 engine 暴露给父组件，供 timeline 联动 flyTo。
// ============================================================

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { TravelMapEngine } from "@/lib/map/engine";
import { landmark } from "@/lib/landmark";
import { prefetchAroundStops } from "@/lib/map/prefetch";
import type { BaseMode } from "@/lib/map/style";
import type { Trip, TripStop } from "@/lib/types";
import { LandmarkMarker } from "./LandmarkMarker";

/** 底图模式（国内/国际）存 localStorage，刷新后保持 */
const BASE_MODE_KEY = "ts-base-mode";
const readBaseMode = (): BaseMode =>
  typeof window !== "undefined" && window.localStorage.getItem(BASE_MODE_KEY) === "domestic"
    ? "domestic"
    : "international";

interface MarkerPos {
  id: string;
  x: number;
  y: number;
}

export function TravelMap({
  trip,
  selectedStopId,
  activeDay,
  onStopClick,
  onReady,
  onFail,
  preserveDrawingBuffer = false,
  pixelRatio,
  hideMarkers = false,
  className = "",
}: {
  trip?: Trip | null;
  selectedStopId?: string | null;
  /** 播放/录制时传当前镜头的天数：非当天的地点标记淡化为 0.4，凸显当天路线 */
  activeDay?: number | null;
  onStopClick?: (stop: TripStop) => void;
  onReady?: (engine: TravelMapEngine) => void;
  onFail?: (message: string) => void;
  /** 录像兜底方案（直接读画布像素）才需要保留 WebGL 绘制缓冲 */
  preserveDrawingBuffer?: boolean;
  /** 录像页用：输出 1080p，给 1.5 倍让地图源分辨率盖过输出，画面不发虚 */
  pixelRatio?: number;
  /** 录像页为 true：DOM 地标层不进视频、每帧还在驱动 React 重渲染，直接关掉 */
  hideMarkers?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<TravelMapEngine | null>(null);
  const tripRef = useRef<Trip | null | undefined>(trip);
  tripRef.current = trip;
  const [positions, setPositions] = useState<MarkerPos[]>([]);
  const [mapFailed, setMapFailed] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [baseMode, setBaseMode] = useState<BaseMode>(readBaseMode);
  /** 指向创建引擎 effect 里的 update()：切底图后标记投影基准变了，要立即重投影 */
  const updateRef = useRef<() => void>(() => {});

  // 创建引擎（StrictMode 下会 create→destroy→recreate 双挂载，
  // 需保证重建安全；WebGL 受限时降级提示而不是崩掉整个应用）
  useEffect(() => {
    if (!containerRef.current) return;
    setMapFailed(null);
    let engine: TravelMapEngine | null = null;
    try {
      engine = new TravelMapEngine(containerRef.current, { baseMode: readBaseMode(), preserveDrawingBuffer, pixelRatio });
      engineRef.current = engine;
      if (process.env.NODE_ENV !== "production") {
        // 调试钩子（仅 dev）：Playwright/控制台可直接驱动引擎
        (window as unknown as { __tsEngine?: TravelMapEngine }).__tsEngine = engine;
      }
      onReady?.(engine);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[travel-story] 地图初始化失败", e);
      setMapFailed(msg);
      onFail?.(msg);
      return;
    }

    const mapEngine = engine;
    let raf = 0;
    // 始终通过 tripRef 读取最新 trip，避免 move 事件闭包捕获旧值
    // 导致 fitToStops 飞行动画期间把标记位置反复清空。
    // 录像页（hideMarkers）不需要 DOM 地标层：整个投影循环跳过，
    // 不驱动每帧的 React 重渲染。
    const update = () => {
      if (hideMarkers) return;
      const stops = tripRef.current?.stops ?? [];
      setPositions(
        stops
          // Globe 模式下地球背面的点不渲染（project 会把它们镜像到球面上）
          .filter((s) => mapEngine.isOnVisibleHemisphere(s.longitude, s.latitude))
          .map((s) => {
            const p = mapEngine.project(s.longitude, s.latitude);
            return { id: s.id, x: p.x, y: p.y };
          })
      );
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    updateRef.current = update;

    const onLoad = () => {
      syncTrip(mapEngine, tripRef.current ?? null);
      update();
    };
    if (mapEngine.map.loaded()) onLoad();
    else mapEngine.map.on("load", onLoad);
    mapEngine.map.on("move", schedule);
    mapEngine.map.on("resize", schedule);

    return () => {
      cancelAnimationFrame(raf);
      mapEngine.map.off("load", onLoad);
      mapEngine.map.off("move", schedule);
      mapEngine.map.off("resize", schedule);
      mapEngine.destroy();
      if (engineRef.current === mapEngine) engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  // trip 数据变化 → 同步路线 + 刷新标记位置
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const whenLoaded = () => {
      syncTrip(engine, trip ?? null);
      // 顺手闲时预热站点周边瓦片（录制时少白块；内部按站点坐标去重）
      if (trip?.stops?.length) prefetchAroundStops(trip.stops);
      if (hideMarkers) return;
      setPositions(
        (trip?.stops ?? [])
          .filter((s) => engine.isOnVisibleHemisphere(s.longitude, s.latitude))
          .map((s) => {
            const p = engine.project(s.longitude, s.latitude);
            return { id: s.id, x: p.x, y: p.y };
          })
      );
    };
    if (engine.map.loaded()) whenLoaded();
    else engine.map.once("load", whenLoaded);
  }, [trip]);

  const posById = new Map(positions.map((p) => [p.id, p]));

  // 一次性清理：注销旧版瓦片 Service Worker（已被本地代理 /api/tiles 取代）；
  // 并申请持久化存储，浏览器 HTTP 缓存里的代理瓦片不被轻易清除。
  useEffect(() => {
    navigator.serviceWorker
      ?.getRegistrations?.()
      .then((rs) => rs.forEach((r) => r.unregister()))
      .catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  /** 国内 ⇄ 国际底图一键切换（持久化到 localStorage） */
  const switchBaseMode = (m: BaseMode) => {
    setBaseMode(m);
    try {
      window.localStorage.setItem(BASE_MODE_KEY, m);
    } catch {
      /* 隐私模式等场景下静默 */
    }
    engineRef.current?.setBaseMode(m);
    // 投影基准（WGS-84 ⇄ GCJ-02）已变，立刻重算标记屏幕位置
    updateRef.current();
  };

  if (mapFailed) {
    return (
      <div className={`map-canvas ${className}`}>
        <div className="map-fallback">
          <p className="font-mono kicker">MAP OFFLINE</p>
          <h3 style={{ margin: "8px 0 4px" }}>地图初始化失败</h3>
          <p style={{ color: "var(--muted)", fontSize: 13, maxWidth: 320 }}>
            原因：{mapFailed}
            <br />
            你仍可在左侧编辑行程，地图恢复后可重新加载。
          </p>
          <button
            className="btn btn-ghost"
            onClick={() => setRetryKey((k) => k + 1)}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`map-canvas ${className}`}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {/* 底图一键切换：国内（高德栅格）⇄ 国际（OpenFreeMap 矢量） */}
      <div className="ts-basemode" role="group" aria-label="底图模式">
        <button
          className={baseMode === "domestic" ? "on" : ""}
          title="高德栅格底图：国内极快；GCJ-02 坐标有偏移，国外无数据"
          onClick={() => switchBaseMode("domestic")}
        >
          国内
        </button>
        <button
          className={baseMode === "international" ? "on" : ""}
          title="OpenFreeMap 矢量底图：自定义样式、全球覆盖，走本地缓存代理"
          onClick={() => switchBaseMode("international")}
        >
          国际
        </button>
      </div>
      <div className="ts-markers">
        {!hideMarkers &&
          trip?.stops.map((stop) => {
            const pos = posById.get(stop.id);
            if (!pos) return null;
            const spec = landmark.match(stop.name, stop.type);
            const active = selectedStopId === stop.id;
            // 非当天地点淡化（播放/录制时），让观众一眼认出当天的是哪些
            const dimmed = activeDay != null && stop.day !== activeDay;
            return (
              <div
                key={stop.id}
                // 当前点提到最上层，避免名称/徽章被相邻点盖住
                style={{ position: "absolute", left: pos.x, top: pos.y, zIndex: active ? 10 : 1 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onStopClick?.(stop);
                }}
              >
                <LandmarkMarker
                  icon={spec.icon}
                  kind={spec.kind}
                  name={stop.name}
                  day={stop.day}
                  active={active}
                  dimmed={dimmed}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}

function syncTrip(engine: TravelMapEngine, trip: Trip | null) {
  if (!trip) return;
  engine.setRoutes(trip.segments);
  if (trip.stops.length) {
    engine.fitToStops(trip.stops, 100);
  }
}

// 重新导出类型供页面使用
export type { TravelMapEngine };
export { maplibregl };
