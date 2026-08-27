"use client";

// ============================================================
// Travel Story — 地球仪画布（GlobeMap）
//
// 独立的轻量地球组件，不复用 TravelMapEngine（那个引擎带载具/路线/
// 底图切换，为规划页服务）。它是首页的唯一背景：
//   1. 默认：整幅背景 = 缓慢自转的地球，不可交互，滚轮穿透给页面滚动；
//   2. 足迹模式（ref.enterFootprints()）：同一个地球实例不停场——
//      停止自转、开放拖拽/缩放、easeTo padding 让球体滑到左侧，
//      小红旗淡入。退出时镜头（中心/缩放/padding）完整复位再恢复自转。
//      全程没有路由跳转、没有重建地图。
//
// 小红旗纯展示：每一个行程地点一面旗，不可点击。
// 底图复用叙事极简矢量样式，仅把投影改成 globe。
// ============================================================

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleForMode } from "@/lib/map/style";
import { absolutizeStyle } from "@/lib/map/engine";

/** 足迹模式插旗的地点：每一段旅程的每一个地点各一面旗 */
export interface GlobeMarker {
  id: string;
  longitude: number;
  latitude: number;
  name: string;
}

/** 命令式 API：主页「我的足迹」按钮驱动模式切换 */
export interface GlobeHandle {
  /** 停转、可交互、地球滑向一侧（padding 由 footprintsPadding 决定） */
  enterFootprints(): void;
  /** 镜头（中心/缩放/padding）完整复位，恢复自转 */
  exitFootprints(): void;
}

interface Props {
  /** 是否缓慢自转（足迹模式下自动停转，退出后恢复） */
  autoRotate?: boolean;
  /** 初始是否响应拖拽/缩放（首页背景要 false，否则滚轮缩放会吃掉页面滚动） */
  interactive?: boolean;
  /** 自转速度（度/秒） */
  rotateSpeed?: number;
  initialCenter?: [number, number];
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  /** 初始镜头内边距：首页用它把地球偏到右边，给左侧 slogan 留纸面。
   *  传函数而不是值——需要在挂载那一刻读 window 尺寸（SSR 期没有） */
  padding?: () => maplibregl.PaddingOptions | undefined;
  /** 足迹模式的目标内边距（地球滑到哪一侧）；窄屏返回 undefined 保持居中 */
  footprintsPadding?: () => maplibregl.PaddingOptions | undefined;
  /** 足迹模式的缩放范围：最小不缩成小弹珠，最大放到街区级别
   *  （建筑/道路细节都出来），任何级别都保持地球形态 */
  footprintsZoom?: { min: number; max: number };
  markers?: GlobeMarker[];
  /** 旗帜层淡入/淡出（CSS 过渡），足迹模式开启时传 true */
  showFlags?: boolean;
  className?: string;
  ref?: React.Ref<GlobeHandle>;
}

const R = Math.PI / 180;
const ZERO_PADDING: maplibregl.PaddingOptions = { left: 0, top: 0, right: 0, bottom: 0 };

/** 屏幕上的一面旗（仅可见半球的点会生成） */
interface FlagPos {
  id: string;
  x: number;
  y: number;
}

export function GlobeMap({
  autoRotate = true,
  interactive = false,
  rotateSpeed = 1.2,
  initialCenter = [108, 32],
  initialZoom = 1.4,
  minZoom = 0.6,
  maxZoom = 4.6,
  padding,
  footprintsPadding,
  footprintsZoom = { min: 1.4, max: 8 },
  markers = [],
  showFlags = false,
  className = "",
  ref,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;
  /** 足迹模式下自转挂起 */
  const footprintsRef = useRef(false);
  /** 挂载时的初始镜头（中心/缩放/padding），退出足迹模式时完整复位 */
  const initialCamRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const initialPadRef = useRef<maplibregl.PaddingOptions | null>(null);
  const zoomRangeRef = useRef({ min: minZoom, max: maxZoom });
  zoomRangeRef.current = { min: minZoom, max: maxZoom };
  const footprintsPadRef = useRef(footprintsPadding);
  footprintsPadRef.current = footprintsPadding;
  const footprintsZoomRef = useRef(footprintsZoom);
  footprintsZoomRef.current = footprintsZoom;
  const [flags, setFlags] = useState<FlagPos[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      enterFootprints() {
        const map = mapRef.current;
        if (!map) return;
        footprintsRef.current = true;
        map.dragPan.enable();
        map.scrollZoom.enable();
        map.doubleClickZoom.enable();
        map.touchZoomRotate.enable();
        map.setMinZoom(footprintsZoomRef.current.min);
        map.setMaxZoom(footprintsZoomRef.current.max);
        map.easeTo({
          padding: footprintsPadRef.current?.() ?? ZERO_PADDING,
          duration: 1400,
          essential: true,
        });
      },
      exitFootprints() {
        const map = mapRef.current;
        if (!map) return;
        map.dragPan.disable();
        map.scrollZoom.disable();
        map.doubleClickZoom.disable();
        map.touchZoomRotate.disable();
        map.setMinZoom(zoomRangeRef.current.min);
        map.setMaxZoom(zoomRangeRef.current.max);
        // 用户在足迹模式里可能拖过/缩过地球：中心、缩放、padding 全部复位
        const cam = initialCamRef.current;
        map.easeTo({
          center: cam?.center,
          zoom: cam?.zoom,
          padding: initialPadRef.current ?? ZERO_PADDING,
          duration: 1400,
          essential: true,
        });
        // 自转等复位动画放完再恢复——jumpTo 会打断进行中的 easeTo，
        // 立刻开转会把还原动画掐死在第一帧（地球停在中途）
        map.once("moveend", () => {
          footprintsRef.current = false;
        });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const style = absolutizeStyle(styleForMode("international"));
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        ...style,
        projection: { type: "globe" },
        // 纸色大气：球体边缘晕开一圈淡青，融入纸面而不是浮在黑太空里
        sky: {
          "sky-color": "#dcebee",
          "horizon-color": "#f6f1e4",
          "fog-color": "#f6f1e4",
          "sky-horizon-blend": 0.6,
          "horizon-fog-blend": 0.6,
          "fog-ground-blend": 0,
          "atmosphere-blend": 1,
        },
      },
      center: initialCenter,
      zoom: initialZoom,
      minZoom,
      maxZoom,
      interactive,
      attributionControl: { compact: true },
      fadeDuration: 120,
      // 地球只是氛围：瓦片需求集中在 z0-z2，给足缓存即可
      maxTileCacheSize: 512,
      refreshExpiredTiles: false,
    });
    mapRef.current = map;
    initialCamRef.current = { center: initialCenter, zoom: initialZoom };
    const pad = padding?.() ?? null;
    initialPadRef.current = pad;
    if (pad) map.setPadding(pad);
    if (process.env.NODE_ENV !== "production") {
      // 调试钩子（仅 dev）：控制台/Playwright 可直接读镜头状态
      (window as unknown as { __tsGlobe?: maplibregl.Map }).__tsGlobe = map;
    }

    // ---- 自转 + 旗子投影（共用一个 rAF 循环）----
    // 自转/滑动会改变所有旗子的屏幕位置，所以投影更新必须挂在
    // 同一帧循环里，不能只在 move 事件里做。
    let raf = 0;
    let lastTs = 0;
    const updateFlags = () => {
      const list = markersRef.current;
      if (!list.length) return;
      const next: FlagPos[] = [];
      for (const m of list) {
        // 问 MapLibre 自己的遮挡判定（球背面/切线地平线外即隐藏）：
        // project() 会把背面点镜像到球面上，不裁掉旗子会浮在球缘外。
        let visible: boolean;
        try {
          visible = !map.transform.isLocationOccluded(new maplibregl.LngLat(m.longitude, m.latitude));
        } catch {
          // 旧版 maplibre 兜底：与镜头中心的球面夹角 < 90°
          const c = map.getCenter();
          visible =
            Math.sin(c.lat * R) * Math.sin(m.latitude * R) +
              Math.cos(c.lat * R) * Math.cos(m.latitude * R) * Math.cos((m.longitude - c.lng) * R) >
            0;
        }
        if (!visible) continue;
        const p = map.project([m.longitude, m.latitude]);
        next.push({ id: m.id, x: p.x, y: p.y });
      }
      setFlags(next);
    };
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      const dt = lastTs ? Math.min(100, ts - lastTs) : 16;
      lastTs = ts;
      if (autoRotate && !footprintsRef.current) {
        const c = map.getCenter();
        // 归一化到 (-180, 180]，防止无限增大
        const lng = ((((c.lng + (dt / 1000) * rotateSpeed + 180) % 360) + 360) % 360) - 180;
        map.jumpTo({ center: [lng, c.lat] });
      }
      updateFlags();
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
    };
    // 只在挂载时建一次图；markers/padding 函数等经 ref 读取最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`globe ${className}`}>
      <div ref={containerRef} className="globe-canvas" />
      {markers.length > 0 && (
        <div className={`globe-flags${showFlags ? " on" : ""}`}>
          {flags.map((f) => (
            <span key={f.id} className="globe-flag" style={{ left: f.x, top: f.y }}>
              <FlagSvg />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 小红旗：三角旗面 + 旗杆，朱砂红，与已行驶路线同色 */
function FlagSvg() {
  return (
    <svg width="22" height="30" viewBox="0 0 22 30" fill="none" aria-hidden="true">
      <line x1="3" y1="4" x2="3" y2="29" stroke="#26211a" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 4 C8 1.5 14 1.5 20 4 L 16.5 8.5 C 12 6.5 7 6.5 3 9 Z" fill="#e4572e" />
      <circle cx="3" cy="3" r="2" fill="#26211a" />
    </svg>
  );
}
