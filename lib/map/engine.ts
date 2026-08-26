// ============================================================
// Travel Story — 地图引擎（TravelMapEngine）
//
// 遵循需求文档 §9/§46 的架构原则：
//   - 地图（BaseMap）与业务数据分离；
//   - 路线 / 车辆 / 镜头各自独立成 Layer / Controller；
//   - 动画逻辑不散落在 React 组件里，全部收敛在这里。
//
// 职责：
//   - 持有 MapLibre 实例（未来可替换 Cesium/Mapbox，见 §9）；
//   - 维护 路线层（计划路线 + 已行驶高亮）与 车辆层（按交通方式切换图标，压在最上层）；
//   - 提供 镜头控制（flyTo / 跟随 / 取景）与 几何投影（供 React 地标层用）。
//
// React 只负责：地标图标的 HTML 覆盖层 + 播放时的界面（场记卡等）。
// ============================================================

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleForMode } from "./style";
import type { StyleSpecification } from "maplibre-gl";
import type { BaseMode } from "./style";
import { vehicleIconSvg, iconDataUrl } from "@/lib/mapIcons";
import { wgs84ToGcj02 } from "@/lib/coord";
import type { TripSegment, TripStop, Transport } from "@/lib/types";

const ROUTE_FAINT = "#CFC3AC";
const ROUTE_TRAVELED = "#E4572E";

/**
 * 地图最小 zoom。Globe 下限 3.3：球体明显大于视口、弧度清晰，
 * 不允许缩成一个小圆球（用户确认过这个尺度感）。
 */
const MIN_ZOOM = 3.3;

/** 全部交通方式（vehicleIconSvg 已覆盖，含 UFO/游泳/火箭），用于预注册图标 */
const ALL_TRANSPORTS: Transport[] = [
  "car", "bus", "train", "subway", "plane", "ship", "kayak",
  "motorcycle", "bicycle", "scooter", "walk", "horse",
  "ufo", "swim", "rocket",
];

/** 每种载具预注册 2 帧 × 2 朝向（正/镜像）共 4 张图 */
const VEHICLE_FRAMES = [0, 1] as const;

export interface CameraState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export class TravelMapEngine {
  map: maplibregl.Map;
  /** 当前投影（setProjection 集中在这里记账，避免重复 setProjection） */
  private proj: "mercator" | "globe" = "mercator";
  /** 投影是否随 zoom 自动切换（播放时由编排器接管，关掉自动） */
  private autoProj = true;
  /** 当前底图模式（国内/国际一键切换，setBaseMode 修改） */
  private baseMode: BaseMode;
  /** 最近一次 setRoutes 的数据：setStyle 会清空业务图层，切底图后要重挂 */
  private lastSegments: TripSegment[] = [];

  constructor(
    container: HTMLElement,
    opts?: {
      initialCenter?: [number, number];
      initialZoom?: number;
      baseMode?: BaseMode;
      /** 录像兜底方案（直接读画布像素）才需要保留绘制缓冲 */
      preserveDrawingBuffer?: boolean;
      /** 录像页给 1.5 倍：输出 1080p，地图源分辨率要盖过输出才不发虚 */
      pixelRatio?: number;
    }
  ) {
    this.baseMode = opts?.baseMode ?? "international";
    this.map = new maplibregl.Map({
      container,
      style: absolutizeStyle(styleForMode(this.baseMode)),
      center: opts?.initialCenter ?? [121.49, 31.24],
      zoom: opts?.initialZoom ?? 10,
      minZoom: MIN_ZOOM,
      maxPitch: 65,
      attributionControl: { compact: true },
      ...(opts?.pixelRatio ? { pixelRatio: opts.pixelRatio } : {}),
      canvasContextAttributes: {
        preserveDrawingBuffer: opts?.preserveDrawingBuffer ?? false,
      },
      // ---- 浏览流畅度（OpenFreeMap 单瓦片延迟 0.5~2s，偶发 5xx）----
      // 内存瓦片缓存加大：回看的区域不用重新解析；
      maxTileCacheSize: 2048,
      // 父级瓦片保留到数据源最大 zoom：子瓦片没来/失败时先用
      // 父级过度放大顶着，减少白块；
      maxTileCacheZoomLevels: 14,
      // 过期的已缓存瓦片直接继续用，不发起重复请求（瓦片按构建号不可变，
      // 持久层另有 public/map-tile-sw.js 做 cache-first）；
      refreshExpiredTiles: false,
      // 瓦片淡入加快，缩短「灰一下再出现」的感知时间。
      fadeDuration: 120,
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    this.map.on("load", () => this.ensureLayers());
    // setStyle（切换底图）会清空全部 source/layer/image 并重置投影，
    // style.load 后重挂业务图层与路线数据（ensureLayers 幂等，初次加载也会触发）
    this.map.on("style.load", () => {
      this.proj = "mercator";
      this.ensureLayers();
      if (this.lastSegments.length) this.setRoutes(this.lastSegments);
    });
    // 用 zoom（手势进行中连续触发）而不是 zoomend：切换藏在拖缩放的过程里，
    // 手势结束时画面已经到位，不会有「顿一下再跳变」的感觉
    this.map.on("zoom", () => this.syncAutoProjection());
  }

  /** 一键切换底图（国内高德栅格 ⇄ 国际 OpenFreeMap 矢量），镜头与业务数据不变 */
  setBaseMode(mode: BaseMode) {
    if (mode === this.baseMode) return;
    this.baseMode = mode;
    this.map.setStyle(absolutizeStyle(styleForMode(mode)));
  }

  /**
   * 业务坐标 → 地图渲染坐标。
   * 业务数据统一 WGS-84；国内模式的高德底图是 GCJ-02（整体偏 ~400m），
   * 所有渲染入口（标记/路线/车辆/镜头/投影）必须经此转换才能与底图对齐。
   */
  toMap(lnglat: [number, number]): [number, number] {
    if (this.baseMode !== "domestic") return lnglat;
    const g = wgs84ToGcj02(lnglat[1], lnglat[0]);
    return [g.lon, g.lat];
  }

  /**
   * Globe / 平面自动切换（§21）：
   * 拉远到洲际视野自动切 Globe；回到省/市视野回到平面。
   * 进出阈值错开（4.2 进 / 4.8 出，迟滞防抖），避免在边界附近来回闪切。
   * （minZoom 3.3 → Globe 有 3.3~4.2 的缩放余量）
   */
  private syncAutoProjection() {
    if (!this.autoProj) return;
    const z = this.map.getZoom();
    if (this.proj === "mercator" && z < 4.2) {
      this.setProjection("globe");
      // 球体只在平视时居中。必须同一帧跳变归零（jumpTo），不能用 easeTo——
      // 滚轮手势还在继续时 easeTo 会被后续 wheel 缩放打断，pitch 归零失败，
      // 第一次进球球心就是歪的（之后 pitch 已是 0，所以后续切换都正常）。
      if (this.map.getPitch() !== 0) {
        this.map.jumpTo({ pitch: 0, center: this.map.getCenter(), zoom: this.map.getZoom() });
      }
    } else if (this.proj === "globe" && z > 4.8) {
      this.setProjection("mercator");
    }
  }

  /** 播放编排器接管投影（跨国航段手动 Globe）时先关自动；结束后恢复 */
  setAutoProjection(on: boolean) {
    this.autoProj = on;
    if (on) this.syncAutoProjection();
  }

  setProjection(p: "mercator" | "globe") {
    if (this.proj === p) return;
    this.proj = p;
    this.map.setProjection({ type: p });
  }

  /**
   * 点是否在地球的可见半球。Globe 模式下 project() 对背面点也会给出
   * 屏幕坐标（镜像到球面上），地标 HTML 层必须用这个方法把背面点藏起来。
   */
  isOnVisibleHemisphere(lng: number, lat: number): boolean {
    if (this.proj !== "globe") return true;
    const c = this.map.getCenter();
    const [mlng, mlat] = this.toMap([lng, lat]);
    const rad = Math.PI / 180;
    const la1 = (c.lat * rad), la2 = mlat * rad, dl = (mlng - c.lng) * rad;
    // 与镜头中心的球面夹角 < 90° = 可见半球
    return Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dl) > 0;
  }

  // ------------------------------------------------------------
  // 图层初始化（幂等）
  // ------------------------------------------------------------

  private ensureLayers() {
    // 每种交通方式注册 4 张图标：ts-vehicle-<t>-<帧> 与 ts-vehicle-<t>-flip-<帧>
    // （镜像版用于朝西行驶，保证侧面视角的载具永远正立、不颠倒）
    for (const t of ALL_TRANSPORTS) {
      for (const f of VEHICLE_FRAMES) {
        this.addIcon(`ts-vehicle-${t}-${f}`, iconDataUrl(vehicleIconSvg(t, f)));
        this.addIcon(`ts-vehicle-${t}-flip-${f}`, iconDataUrl(vehicleIconSvg(t, f, true)));
      }
    }

    // 数据源
    const sources: Record<string, maplibregl.GeoJSONSourceSpecification> = {
      "ts-routes": { type: "geojson", data: emptyFC() },
      "ts-traveled": { type: "geojson", data: emptyFC() },
      "ts-vehicle": { type: "geojson", data: emptyFC() },
    };
    for (const [id, spec] of Object.entries(sources)) {
      if (!this.map.getSource(id)) this.map.addSource(id, spec);
    }

    // 计划路线（真实道路，淡色实线）
    this.addLayer(
      {
        id: "ts-route-faint",
        type: "line",
        source: "ts-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_FAINT,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.6, 14, 3],
          "line-opacity": 0.85,
        },
      },
      "place-city"
    );

    // 已行驶路线（朱砂红高亮，播放中逐渐延长；在计划路线之上、地名之下）
    this.addLayer(
      {
        id: "ts-route-traveled",
        type: "line",
        source: "ts-traveled",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_TRAVELED,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.6, 14, 4.5],
        },
      },
      "place-city"
    );

    // 车辆符号层（单层，图标名与旋转角全部由 feature 属性驱动：
    // setVehicle 已按行驶方向算好 正/镜像图标 + 旋转角 + 动画帧）。
    // 不加 beforeId：压在所有图层（含已行驶红线）之上，载具永远不被线盖住。
    // text-field 是载具头顶的实时里程牌（走了 1.2 km 这种），属性驱动、随时可清。
    this.addLayer({
      id: "ts-vehicle",
      type: "symbol",
      source: "ts-vehicle",
      layout: {
        "icon-image": ["get", "icon"] as unknown as string,
        // 卡通插画原生 120x80，放大到约 65-115px，看清载具细节
        "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.55, 10, 0.7, 14, 0.95],
        "icon-rotate": ["get", "rotate"] as unknown as number,
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": ["get", "label"] as unknown as string,
        "text-font": ["Noto Sans Bold"],
        "text-size": 13,
        // 载具图标高约 44-76px（随 zoom），里程牌钉在它头顶上方
        "text-anchor": "bottom",
        "text-offset": [0, -2.6],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#26211A",
        "text-halo-color": "#F6F1E4",
        "text-halo-width": 2,
      },
    });
    this.hideVehicle();
  }

  private addLayer(layer: maplibregl.LayerSpecification, beforeId?: string) {
    if (!this.map.getLayer(layer.id)) {
      this.map.addLayer(layer, beforeId);
    }
  }

  private addIcon(id: string, dataUrl: string) {
    if (this.map.hasImage(id)) return;
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      if (!this.map.hasImage(id)) this.map.addImage(id, img);
    };
  }

  // ------------------------------------------------------------
  // RouteLayer — 计划路线 + 已行驶高亮
  // ------------------------------------------------------------

  setRoutes(segments: TripSegment[]) {
    this.lastSegments = segments;
    const src = this.map.getSource("ts-routes") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    // 只画已取得真实路线的路段；尚未取到的路段不画（以前用占位虚线，
    // 用户反馈太乱，已去掉——路线拉取成功后自然出现）
    const real = segments
      .filter((s) => s.route && s.route.coordinates.length > 1)
      .map((s) => ({
        type: "Feature" as const,
        properties: { id: s.id },
        geometry: {
          type: "LineString" as const,
          coordinates: s.route!.coordinates.map((c) => this.toMap(c)),
        },
      }));

    src.setData({ type: "FeatureCollection", features: real } as never);
  }

  /** 显示/隐藏「已规划路线」（淡色实线）。
   *  播放时隐藏，让朱砂红的已行驶路径逐段揭示，避免整条线先剧透。 */
  setRoutesVisible(visible: boolean) {
    const v: "visible" | "none" = visible ? "visible" : "none";
    const faint = this.map.getLayer("ts-route-faint");
    if (faint) this.map.setLayoutProperty("ts-route-faint", "visibility", v);
  }

  setTraveled(coords: [number, number][]) {
    const src = this.map.getSource("ts-traveled");
    if (!src) return;
    const mapped = coords.map((c) => this.toMap(c));
    (src as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features:
        mapped.length > 1
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: mapped } }]
          : [],
    } as never);
  }

  clearTraveled() {
    this.setTraveled([]);
  }

  // ------------------------------------------------------------
  // VehicleLayer — 汽车 / 飞机
  // ------------------------------------------------------------

  /**
   * 放置载具图标。
   * @param bearing 行驶方向角（正北 0°，顺时针）。播放层只传 90（东）/270（西），
   *                即整段行程车头恒定朝右/朝左，不随弯道转向。
   * @param frame   动画帧（0/1），两帧交替产生颠簸/摆腿/冒烟等动效
   * @param label   载具头顶的实时里程牌文本（如 "1.2 km"），空串不显示
   *
   * 侧面视角的载具朝西（bearing ∈ (180°, 360°)）时用水平镜像图标，
   * 保证永远正立、不颠倒。
   */
  setVehicle(point: [number, number], bearing: number, transport: Transport, frame = 0, label = "") {
    const src = this.map.getSource("ts-vehicle");
    if (!src) return;
    const b = ((bearing % 360) + 360) % 360;
    const flip = b > 180;
    const rotate = flip ? b + 90 : b - 90;
    const icon = `ts-vehicle-${transport}${flip ? "-flip" : ""}-${frame ? 1 : 0}`;
    (src as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { icon, rotate, label },
          geometry: { type: "Point", coordinates: this.toMap(point) },
        },
      ],
    } as never);
  }

  hideVehicle() {
    const src = this.map.getSource("ts-vehicle");
    if (src) (src as maplibregl.GeoJSONSource).setData(emptyFC());
  }

  // ------------------------------------------------------------
  // CameraController — 镜头（§19/§20/§21）
  // ------------------------------------------------------------

  flyToStop(stop: TripStop, zoom = 14.2) {
    this.flyTo({ center: [stop.longitude, stop.latitude], zoom, bearing: 0, pitch: 50 }, 2200);
  }

  flyTo(cam: CameraState, duration = 2000) {
    this.map.flyTo({
      center: this.toMap(cam.center),
      zoom: cam.zoom,
      bearing: cam.bearing,
      pitch: cam.pitch,
      duration,
      essential: true,
    });
  }

  /** 播放中逐帧跟随：对目标镜头做 lerp 平滑（滞后跟随，见 §19/§20） */
  jumpCamera(cam: CameraState, lag = 0.35) {
    const c = this.map.getCenter();
    const z = this.map.getZoom();
    const b = this.map.getBearing();
    const p = this.map.getPitch();
    const target = this.toMap(cam.center);
    const next = {
      center: [
        c.lng + (target[0] - c.lng) * lag,
        c.lat + (target[1] - c.lat) * lag,
      ] as [number, number],
      zoom: z + (cam.zoom - z) * lag,
      bearing: b + shortestAngle(b, cam.bearing) * lag,
      pitch: p + (cam.pitch - p) * lag,
    };
    this.map.jumpTo(next);
  }

  fitToStops(stops: TripStop[], padding = 90) {
    if (!stops.length) return;
    const pts = stops.map((s) => this.toMap([s.longitude, s.latitude]));
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];
    // 目标若是洲际视野（进球区间）：先切球、pitch 归零再飞。
    // 否则飞行中途被 syncAutoProjection 打断，镜头停在半路，球心歪掉
    // （「变成地球时球心必须统一」——无论从哪条路径进球，球心都居中）。
    const cam = this.map.cameraForBounds(bounds, { padding, maxZoom: 13 });
    const goingGlobe = (cam?.zoom ?? 13) < 4.2;
    if (this.autoProj && goingGlobe && this.proj === "mercator") {
      this.setProjection("globe");
      if (this.map.getPitch() !== 0) {
        this.map.jumpTo({ pitch: 0, center: this.map.getCenter(), zoom: this.map.getZoom() });
      }
    }
    this.map.fitBounds(bounds, {
      padding,
      duration: 1400,
      maxZoom: 13,
      pitch: this.proj === "globe" ? 0 : 40,
    });
  }

  /** 地图坐标 → 屏幕像素（React 地标层用） */
  project(lng: number, lat: number): { x: number; y: number } {
    const p = this.map.project(this.toMap([lng, lat]));
    return { x: p.x, y: p.y };
  }

  resize() {
    this.map.resize();
  }

  destroy() {
    this.map.remove();
  }
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** 把样式里的相对 URL（/api/tiles/…）补成绝对地址（MapLibre 对相对 URL 支持不可靠） */
export function absolutizeStyle(style: StyleSpecification): StyleSpecification {
  if (typeof window === "undefined") return style;
  const abs = (u?: string) => (u && u.startsWith("/") ? window.location.origin + u : u);
  const sources = { ...style.sources } as Record<string, { url?: string }>;
  if (sources.openmaptiles?.url) {
    sources.openmaptiles = { ...sources.openmaptiles, url: abs(sources.openmaptiles.url) };
  }
  const glyphs = abs(style.glyphs);
  return {
    ...style,
    // 栅格样式无 glyphs：必须整个 key 都不带，显式 undefined 会被
    // MapLibre 样式校验拒绝（glyphs: string expected, undefined found）
    ...(glyphs ? { glyphs } : {}),
    sources,
  } as StyleSpecification;
}
