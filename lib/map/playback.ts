// ============================================================
// Travel Story — 播放编排器（AnimationController）
//
// 需求文档 §25「行程预览」：这是最终旅行纪录片地图动画的预览。
// 一个镜头序列：
//   开场（全览） → 对每个地点：飞入特写 → 转场（车沿真实道路
//   行驶 / 飞机沿大圆航线） → 到达下一点。
//
// 与 React 解耦：本模块只驱动 MapLibre 图层与镜头，通过
// PlaybackCallbacks 把「当前镜头」通知给界面（场记卡、地标高亮）。
// 支持随时取消（用户点退出）。
// ============================================================

import { routing, sampleAlongLine, formatDistance } from "@/lib/routing";
import { TRANSPORT_KIND } from "@/lib/types";
import type { TripSegment, TripStop, Transport } from "@/lib/types";
import type { CameraState, TravelMapEngine } from "./engine";

/** 载具两帧动画的切帧间隔（ms） */
const FRAME_MS = 260;
const animFrame = (now: number) => (Math.floor(now / FRAME_MS) % 2) as 0 | 1;

/** 章节卡停留：每一天都是新的一天，翻篇时给 1.6s 看清 DAY xx */
export const DAY_CARD_MS = 1600;

/** 陆路长距离阈值：超过则不再贴身跟随，改为缩小取景看全程 */
const LONG_DRIVE_M = 150_000;
/** 陆路洲际阈值：超过则与飞机一致切 Globe 球面跟随 */
const GLOBE_DRIVE_M = 800_000;

/** 段前拉远的镜头时长（flyTo / fitBounds）：先把镜头从地点特写拉到
 *  本段取景，到位后载具才出发、轨迹才开始生长——不做「边拉边远边画线」 */
const DEPART_FLY_MS = 600;
/** 拉远等待 = 镜头时长 + 一拍落定缓冲（fitBounds 1100ms 对应 1250） */
const DEPART_WAIT_MS = 700;
const OVERVIEW_WAIT_MS = 1250;

export interface PlaybackShot {
  type: "intro" | "day" | "stop" | "segment";
  index: number;
  stop?: TripStop;
  /** segment 镜头：行程目的地（「从哪里到哪里」的「哪里」） */
  nextStop?: TripStop;
  segment?: TripSegment;
  day?: number;
}

export interface PlaybackCallbacks {
  /** 进入新镜头：React 据此渲染场记卡、高亮地标 */
  onShot(shot: PlaybackShot): void;
  /** 全部播完 */
  onEnd(cancelled: boolean): void;
}

export interface PlaybackController {
  cancel(): void;
  done: Promise<void>;
}

interface PlayOptions {
  engine: TravelMapEngine;
  stops: TripStop[];
  segments: TripSegment[];
  callbacks: PlaybackCallbacks;
  /** 地点特写停留时长（ms）：默认 2000；录像版按素材数量加长，
   *  让图片/视频有播完的时间 */
  stopDwellMs?: (stop: TripStop) => number;
}

export function playTrip(opts: PlayOptions): PlaybackController {
  const { engine, stops, segments, callbacks } = opts;
  let cancelled = false;
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waitDone: (() => void) | null = null;
  let settle: () => void = () => {};
  const done = new Promise<void>((r) => (settle = r));

  const segByFrom = new Map(segments.map((s) => [s.fromStopId, s]));
  // 视野短边：跟随/取景 zoom 按它自适应（竖屏容器窄，同样路程要拉得更远）
  const vpMin = viewportMinPx(engine);

  const cancel = () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    // 放行挂起的 wait：取消时播放流程能走完 finally 收尾（onEnd 一定会触发），
    // 否则 await wait 永远悬挂，录制器收不到结束信号
    waitDone?.();
    engine.hideVehicle();
    engine.clearTraveled();
    engine.setRoutesVisible(true);
    engine.setProjection("mercator");
    engine.setAutoProjection(true);
    settle();
  };

  const shot = (s: PlaybackShot) => callbacks.onShot(s);

  const wait = (ms: number) =>
    new Promise<void>((r) => {
      waitDone = r;
      timer = setTimeout(() => {
        waitDone = null;
        r();
      }, ms);
    });

  /** 沿折线行驶一段（§16-§20） */
  const drive = async (seg: TripSegment, from: TripStop, to: TripStop) => {
    // 路段没有真实路线时（例如规划页 OSRM 还没返回、或旧的兜底直线已被清掉），
    // 播放时现取一次，让车沿真实道路走；失败再退化为起终点直线。
    let coords = seg.route?.coordinates;
    let dist = seg.distance;
    if (!coords || coords.length < 2) {
      try {
        const res = await routing.getRoute(
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
          seg.transport
        );
        coords = res.route.coordinates;
        dist = res.distance;
      } catch {
        coords = [fromPos(from), fromPos(to)];
      }
    }
    if (cancelled || coords!.length < 2) return;
    const transport: Transport = seg.transport;
    const line = coords!;
    // 距离未知时（路由拉取失败退化为起终点直线）按球面距离估算，
    // 否则上海→巴黎会被当成 8km 走贴身跟随，长途修复就失效了。
    const distanceM = dist ?? haversineM(line[0], line[line.length - 1]);
    // 大方向恒定：整段只看起点→终点的东西向，车头全程朝左或朝右，
    // 不随路面弯道转向（避免抖动/乱转）。
    const heading = to.longitude >= from.longitude ? 90 : 270;

    // 固定约 3 秒；镜头缩放按距离与视野短边自适应——路近放大、路远缩小、
    // 竖屏再拉远些，让屏幕上景物掠过速度（像素/秒）恒定，感官速度一致。
    const duration = 3000;
    const followZoom = zoomForDistance(distanceM, from.latitude, vpMin);

    // 长途陆路（如上海开车到巴黎）：zoomForDistance 被钳在 9.2，贴身跟随
    // 会变成「沿路一点一点爬」。改为缩小取景——先把镜头拉到能看全整段路
    // （洲际段与飞机一致切 Globe 球面），随后镜头固定，让车横穿屏幕。
    const useGlobe = distanceM > GLOBE_DRIVE_M;
    const overview = !useGlobe && distanceM > LONG_DRIVE_M;
    // 长途缩小后镜头固定，真实道路的每个弯道都会变成图标的高频抖动。
    // 重采样 + 滑动平均，把折线 smoothing 到与取景尺度匹配的光滑度；
    // 已行驶轨迹同样画这条平滑线，车与线始终一致。
    const animLine = overview || useGlobe ? smoothLine(line) : line;

    // 先拉远，再出发：镜头从地点特写拉到本段取景并落定，之后载具才出现、
    // 轨迹才开始生长（拉远目标即跟随镜头起点，移动中不再叠加拉远）。
    // 拉远开始前就清掉上一段遗留的已行驶红线——它属于上一段，
    // 不该挂到新一段的镜头里、等新轨迹出现时才被顶掉。
    engine.clearTraveled();
    if (useGlobe) {
      engine.setProjection("globe");
      engine.flyTo(
        { center: [from.longitude, from.latitude], zoom: 4.5, bearing: 0, pitch: 30 },
        DEPART_FLY_MS
      );
      await wait(DEPART_WAIT_MS);
    } else if (overview) {
      fitToLine(engine, line);
      await wait(OVERVIEW_WAIT_MS);
    } else {
      engine.flyTo(
        { center: [from.longitude, from.latitude], zoom: followZoom, bearing: 0, pitch: 42 },
        DEPART_FLY_MS
      );
      await wait(DEPART_WAIT_MS);
    }
    if (cancelled) return;

    await new Promise<void>((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        if (cancelled) return resolve();
        const t = Math.min(1, (now - start) / duration);
        const s = sampleAlongLine(animLine, t);
        // 载具头顶钉实时里程：走了多远一眼有数（字幕里的总里程是静态版）
        engine.setVehicle(s.point, heading, transport, animFrame(now), formatDistance(distanceM * t));
        engine.setTraveled(s.traveled);
        if (useGlobe) {
          // 球面跟随（同 fly 的长航段处理）
          engine.jumpCamera({ center: s.point, zoom: 4.5, bearing: 0, pitch: 30 }, 0.35);
        } else if (!overview) {
          engine.jumpCamera(cameraForDrive(s.point, s.bearing, t, from, to, followZoom), 0.42);
        }
        // overview：镜头固定不动，车沿路线横穿全图

        if (t < 1) {
          raf = requestAnimationFrame(step);
        } else {
          engine.setTraveled(animLine);
          if (useGlobe) engine.setProjection("mercator");
          resolve();
        }
      };
      raf = requestAnimationFrame(step);
    });
  };

  /** 大圆航线飞行（§22 飞机动画；UFO/火箭等空中载具同走此路径） */
  const fly = async (seg: TripSegment, from: TripStop, to: TripStop) => {
    const coords = seg.route?.coordinates ?? [fromPos(from), toPos(to)];
    if (coords.length < 2) return;
    const dist = seg.distance ?? 900000;
    const duration = 3200;
    const useGlobe = dist > 800000;
    // 与 drive 一致：整段航向固定，只分左右
    const heading = to.longitude >= from.longitude ? 90 : 270;

    // 先拉远再起飞（同 drive）：拉到能看全航段的高度并落定，飞机才出发、
    // 轨迹才开始生长。拉远目标即跟随起点高度，起飞后不再叠加缩放。
    // 拉远开始前清掉上一段遗留的已行驶红线（同 drive）。
    engine.clearTraveled();
    if (useGlobe) engine.setProjection("globe");
    engine.flyTo(
      { center: [from.longitude, from.latitude], zoom: useGlobe ? 4.5 : zoomForDistance(dist, from.latitude, vpMin), bearing: 0, pitch: 30 },
      DEPART_FLY_MS
    );
    await wait(DEPART_WAIT_MS);
    if (cancelled) return;

    await new Promise<void>((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        if (cancelled) return resolve();
        const t = Math.min(1, (now - start) / duration);
        const s = sampleAlongLine(coords, t);
        engine.setVehicle(s.point, heading, seg.transport, animFrame(now), formatDistance(dist * t));
        // 空中航段同样画「已行驶」轨迹（飞机/UFO/火箭 都覆盖）
        engine.setTraveled(s.traveled);
        // 高空跟随：globe 用固定球面高度，区域航段按距离与视野自适应
        const z = useGlobe ? 4.5 : zoomForDistance(dist, s.point[1], vpMin);
        engine.jumpCamera(
          { center: s.point, zoom: z, bearing: 0, pitch: 30 },
          0.35
        );
        if (t < 1) {
          raf = requestAnimationFrame(step);
        } else {
          if (useGlobe) engine.setProjection("mercator");
          resolve();
        }
      };
      raf = requestAnimationFrame(step);
    });
  };

  // ------------------------------------------------------------
  // 主流程
  // ------------------------------------------------------------

  /** 等地图样式与图层就绪（车辆/路线 source 在 load 后才存在） */
  const whenLoaded = () =>
    new Promise<void>((r) => {
      if (engine.map.loaded()) r();
      else {
        const onLoad = () => {
          engine.map.off("load", onLoad);
          r();
        };
        engine.map.on("load", onLoad);
      }
    });

  (async () => {
    try {
      await whenLoaded();
      if (cancelled) return;
      // 播放期间投影由编排器手动控制（跨国航段 Globe），关掉随 zoom 的自动切换
      engine.setAutoProjection(false);
      // 播放时隐藏已规划路线，让红色「已行驶」路径逐段揭示
      engine.setRoutesVisible(false);
      engine.fitToStops(stops, 110);
      engine.clearTraveled();
      shot({ type: "intro", index: 0 });
      await wait(2400);

      for (let i = 0; i < stops.length; i++) {
        if (cancelled) break;
        const stop = stops[i];
        const day = stop.day;

        // 新的一天（含第 1 天）：章节卡。每一天都是新的一天——
        // 跨天不做载具行程，由章节卡翻篇，不与前一天关联；
        // 翻篇前先清掉地图上的红色已行驶轨迹，再出章节卡
        if (i === 0 || stop.day !== stops[i - 1].day) {
          engine.clearTraveled();
          shot({ type: "day", index: i + 1, stop, day });
          await wait(DAY_CARD_MS);
          if (cancelled) break;
        }

        // 地点特写（录像版停留加长：要给素材展示留时间）
        engine.flyToStop(stop, 14.2);
        shot({ type: "stop", index: i + 1, stop, day });
        await wait(opts.stopDwellMs?.(stop) ?? 2000);
        if (cancelled) break;

        // 转场到下一个地点（仅同一天内；跨天由章节卡接管）
        const seg = segByFrom.get(stop.id);
        const next = stops[i + 1];
        if (seg && next && next.day === day) {
          engine.hideVehicle();
          shot({ type: "segment", index: i + 1, segment: seg, stop, nextStop: next, day });
          await wait(700);
          if (cancelled) break;
          if (TRANSPORT_KIND[seg.transport] === "air") {
            await fly(seg, stop, next);
          } else {
            await drive(seg, stop, next);
          }
          engine.hideVehicle();
        }
      }
    } finally {
      engine.clearTraveled();
      engine.hideVehicle();
      engine.setRoutesVisible(true);
      engine.setProjection("mercator");
      engine.setAutoProjection(true);
      settle();
      callbacks.onEnd(cancelled);
    }
  })();

  return { cancel, done };
}

// ------------------------------------------------------------
// 帮助函数
// ------------------------------------------------------------

function cameraForDrive(
  point: [number, number],
  _bearing: number,
  t: number,
  _from: TripStop,
  to: TripStop,
  followZoom: number
) {
  // 固定上北下南（bearing 恒为 0）、低俯仰：镜头只平移不旋转，避免随车晃导致眩晕。
  // 车辆图标自身仍会转向（见 engine 的 icon-rotate）。
  // followZoom 已按距离算好（路近大、路远小），保证屏幕掠过速度恒定。
  // 出发拉远在移动前已完成（先拉远再出轨迹），行驶中镜头纯平移跟随；
  // 收尾 88-100% 推向目的地（更近些）。
  if (t > 0.88) {
    const k = (t - 0.88) / 0.12;
    return {
      center: [point[0] + (to.longitude - point[0]) * k, point[1] + (to.latitude - point[1]) * k] as [number, number],
      zoom: followZoom + 0.9 * k,
      bearing: 0,
      pitch: 40 + 4 * k,
    };
  }
  return {
    center: point,
    zoom: followZoom,
    bearing: 0,
    pitch: 42,
  };
}

/**
 * 长途陆路的折线平滑：
 *  1) 按弧长等距重采样到固定点数（点数恒定 → 平滑尺度随路程长短自适应）；
 *  2) 两遍滑动平均削掉弯道高频抖动。
 * 端点始终固定，保证起终点仍精确落在车站/机场位置。
 */
function smoothLine(line: [number, number][]): [number, number][] {
  const POINTS = 120; // 重采样点数：12 万米 与 1.2 万千米 都压到同一粒度
  const RADIUS = 3;   // 滑动平均半径（点数）
  const PASSES = 2;
  let cur = resampleByArcLength(line, POINTS);
  for (let p = 0; p < PASSES; p++) {
    const next: [number, number][] = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      let x = 0, y = 0, n = 0;
      for (let k = -RADIUS; k <= RADIUS; k++) {
        const j = Math.min(cur.length - 1, Math.max(0, i + k));
        x += cur[j][0];
        y += cur[j][1];
        n++;
      }
      next.push([x / n, y / n]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** 按弧长等距重采样到 n 个点（含原起终点） */
function resampleByArcLength(line: [number, number][], n: number): [number, number][] {
  if (line.length <= 2 || n < 2) return line;
  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    cum.push(cum[i - 1] + haversineM(line[i - 1], line[i]));
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return [line[0]];
  const out: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = (i / (n - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const segLen = cum[j + 1] - cum[j] || 1;
    const k = (target - cum[j]) / segLen;
    out.push([
      line[j][0] + (line[j + 1][0] - line[j][0]) * k,
      line[j][1] + (line[j + 1][1] - line[j][1]) * k,
    ]);
  }
  return out;
}

/**
 * 长途陆路的一次性取景：缩小到整段路线可见（留边距，低俯仰），
 * 之后镜头固定，车沿路线横穿屏幕。从地点特写拉远的过程即「缩小」 reveal。
 */
function fitToLine(engine: TravelMapEngine, line: [number, number][]) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of line) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  // fitBounds 直达 MapLibre、绕过 engine 镜头方法，需手动过一遍坐标系转换
  const sw = engine.toMap([minLng, minLat]);
  const ne = engine.toMap([maxLng, maxLat]);
  engine.map.fitBounds([sw, ne], { padding: 110, duration: 1100, bearing: 0, pitch: 25 });
}

/**
 * 按路程距离算跟随镜头 zoom：让整段路在屏幕上约占视野短边的 52%
 * （横屏 1080 高的窗口 ≈ 560px，3 秒走完 ≈ 187px/s），从而无论远近，
 * 景物掠过屏幕的速度一致。
 * 视野短边随容器走（viewportMinPx）：竖屏 9:16 容器窄，同一段路要拉得
 * 更远才装得下——否则横屏刚好的跟随高度，竖屏里路线会顶到屏幕边。
 *  m/px ≈ 地球周长 / (512 · 2^z) · cos(lat)
 *  => z = log2(周长 · cos(lat) · 目标px / (512 · 距离米))
 */
function zoomForDistance(distanceMeters: number, latitudeDeg: number, viewportMinPx = 1080): number {
  const targetPx = clamp(220, 560, viewportMinPx * 0.52);
  const EARTH = 40075017;
  const TILE = 512;
  const lat = (latitudeDeg * Math.PI) / 180;
  const z =
    Math.log2((EARTH * Math.cos(lat) * targetPx) / (TILE * Math.max(200, distanceMeters)));
  // zoom 下限随视野收窄等比下调（横屏基准 9.2 @ 1080px）
  const floor = viewportMinPx >= 1000 ? 9.2 : 9.2 - Math.log2(1000 / viewportMinPx);
  return clamp(floor, 15, z);
}

/** 取景视野的短边像素：跟随镜头缩放按它适配（竖屏容器窄，拉得更远） */
function viewportMinPx(engine: TravelMapEngine): number {
  const c = engine.map.getContainer();
  const m = Math.min(c.clientWidth, c.clientHeight);
  return m > 0 ? m : 1080;
}

function fromPos(s: TripStop): [number, number] {
  return [s.longitude, s.latitude];
}
function toPos(s: TripStop): [number, number] {
  return [s.longitude, s.latitude];
}

/** 球面距离（米），与 routing.ts 内部 dist 同一近似 */
function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function clamp(min: number, max: number, v: number) {
  return Math.max(min, Math.min(max, v));
}

// ============================================================
// 离线渲染时间表（buildTimeline）
//
// 纪录片「逐帧离线渲染」用：与 playTrip 同一套镜头语言，但时间轴是
// 虚拟的——给定虚拟时刻 t(ms)，纯函数返回相机/载具/已行驶/投影状态，
// 不依赖墙钟与 MapLibre 自带动画。渲染泵逐帧采样即可：
// 机器慢就慢慢渲，成片帧间隔严格相等，绝不掉帧。
// ============================================================

export interface Timeline {
  /** 行程部分总时长（不含片尾字幕） */
  totalMs: number;
  /** 镜头切换点（intro → stop/segment 交替），按时间升序 */
  shots: { startMs: number; shot: PlaybackShot }[];
  cameraAt(tMs: number): CameraState;
  /** distM：该时刻本段已行驶的米数（载具头顶里程牌用） */
  vehicleAt(tMs: number): { point: [number, number]; heading: number; transport: Transport; distM?: number } | null;
  traveledAt(tMs: number): [number, number][] | null;
  projectionAt(tMs: number): "mercator" | "globe";
}

interface TimelineSpan {
  start: number;
  end: number;
  projection: "mercator" | "globe";
  camera(tMs: number): CameraState;
  vehicle(tMs: number): { point: [number, number]; heading: number; transport: Transport } | null;
  traveled(tMs: number): [number, number][] | null;
}

/** 飞入镜头的 easing（近似 MapLibre flyTo 的缓入缓出） */
function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 两镜头间插值：zoom 是 log 刻度，线性插值即等比缩放，视觉上就是「飞」 */
function lerpCam(a: CameraState, b: CameraState, k: number): CameraState {
  return {
    center: [
      a.center[0] + (b.center[0] - a.center[0]) * k,
      a.center[1] + (b.center[1] - a.center[1]) * k,
    ],
    zoom: a.zoom + (b.zoom - a.zoom) * k,
    bearing: a.bearing + (b.bearing - a.bearing) * k,
    pitch: a.pitch + (b.pitch - a.pitch) * k,
  };
}

export async function buildTimeline(opts: {
  engine: TravelMapEngine;
  stops: TripStop[];
  segments: TripSegment[];
  /** 同 playTrip：地点特写停留时长（录像版按素材数量加长） */
  stopDwellMs: (stop: TripStop) => number;
}): Promise<Timeline> {
  const { engine, stops, segments } = opts;
  const segByFrom = new Map(segments.map((s) => [s.fromStopId, s]));
  // 视野短边（同 playTrip）：竖屏容器窄，跟随 zoom 要拉得更远才装得下
  const vpMin = viewportMinPx(engine);

  // ---- 预取陆路缺失的真实路线（同 playTrip drive() 的兜底；空中段不取）----
  const segLines = new Map<string, [number, number][]>();
  const segDists = new Map<string, number>();
  for (let i = 0; i < stops.length - 1; i++) {
    const seg = segByFrom.get(stops[i].id);
    if (!seg) continue;
    if (TRANSPORT_KIND[seg.transport] === "air") {
      segLines.set(seg.id, seg.route?.coordinates ?? [fromPos(stops[i]), fromPos(stops[i + 1])]);
      segDists.set(seg.id, seg.distance ?? 900000);
      continue;
    }
    let coords = seg.route?.coordinates;
    let dist = seg.distance;
    if (!coords || coords.length < 2) {
      try {
        const res = await routing.getRoute(fromPos(stops[i]), fromPos(stops[i + 1]), seg.transport);
        coords = res.route.coordinates;
        dist = res.distance;
      } catch {
        coords = [fromPos(stops[i]), fromPos(stops[i + 1])];
      }
    }
    segLines.set(seg.id, coords!);
    segDists.set(seg.id, dist ?? haversineM(coords![0], coords![coords!.length - 1]));
  }

  // ---- 开场全览相机（与 fitToStops(stops, 110) 等价，业务坐标系）----
  const lngs = stops.map((s) => s.longitude);
  const lats = stops.map((s) => s.latitude);
  const fit = engine.map.cameraForBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 110, maxZoom: 13 }
  );
  const fitCenter = fit?.center ? lngLatOf(fit.center) : null;
  const introCam: CameraState = {
    center: fitCenter ?? fromPos(stops[0]),
    zoom: fit?.zoom ?? 5,
    bearing: 0,
    pitch: 40,
  };

  const shots: Timeline["shots"] = [{ startMs: 0, shot: { type: "intro", index: 0 } }];
  const spans: TimelineSpan[] = [];
  const staticSpan = (
    start: number,
    end: number,
    cam: CameraState,
    traveled: [number, number][] | null
  ): TimelineSpan => ({
    start, end, projection: "mercator",
    camera: () => cam,
    vehicle: () => null,
    traveled: () => traveled,
  });

  const INTRO_MS = 2400;
  const SEG_SLATE_MS = 700; // 段前场记停留（同 playTrip）
  const FLY_IN_MS = 2200;   // 地点特写飞入（同 flyToStop）
  // 段前拉远（同 playTrip：先拉远再出轨迹）——普通段 flyTo 600 + 落定一拍；
  // 长途缩小取景 fitBounds 1100 + 落定一拍
  const SEG_DEPART_MS = 700;
  const SEG_DEPART_FAR_MS = 1250;

  spans.push(staticSpan(0, INTRO_MS, introCam, null));
  let t = INTRO_MS;
  let prevCam = introCam;
  let lastTraveled: [number, number][] | null = null;

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const stopCam: CameraState = { center: fromPos(stop), zoom: 14.2, bearing: 0, pitch: 50 };
    const dwell = opts.stopDwellMs(stop);
    // 新的一天（含第 1 天）：章节卡翻篇。每一天都是新的一天——
    // 跨天不做载具行程，由章节卡接管（同 playTrip）；
    // 翻篇时清掉红色已行驶轨迹：章节卡与新的一天都不带上一段的线
    if (i === 0 || stop.day !== stops[i - 1].day) {
      shots.push({ startMs: t, shot: { type: "day", index: i + 1, stop, day: stop.day } });
      spans.push(staticSpan(t, t + DAY_CARD_MS, prevCam, null));
      lastTraveled = null;
      t += DAY_CARD_MS;
    }
    shots.push({ startMs: t, shot: { type: "stop", index: i + 1, stop, day: stop.day } });
    const flyFrom = prevCam;
    const spanStart = t;            // 闭包必须捕获值，t 之后还会变
    const traveledAtStart = lastTraveled;
    spans.push({
      start: spanStart, end: spanStart + dwell, projection: "mercator",
      camera: (now) =>
        lerpCam(flyFrom, stopCam, easeInOut(Math.min(1, (now - spanStart) / FLY_IN_MS))),
      vehicle: () => null,
      traveled: () => traveledAtStart,
    });
    prevCam = stopCam;
    t += dwell;

    const seg = segByFrom.get(stop.id);
    const next = stops[i + 1];
    const line = seg ? segLines.get(seg.id) : undefined;
    // 载具行程只在同一天内；跨天由下一天的章节卡接管
    if (!seg || !next || next.day !== stop.day || !line || line.length < 2) continue;
    const air = TRANSPORT_KIND[seg.transport] === "air";
    const distanceM = segDists.get(seg.id)!;
    const useGlobe = air ? distanceM > 800000 : distanceM > GLOBE_DRIVE_M;
    const overview = !air && !useGlobe && distanceM > LONG_DRIVE_M;
    const animLine = overview || useGlobe ? smoothLine(line) : line;
    const durationMs = air ? 3200 : 3000;
    const heading = next.longitude >= stop.longitude ? 90 : 270;
    const followZoom = zoomForDistance(distanceM, stop.latitude, vpMin);
    // 长途缩小取景（与 fitToLine 等价）：整段路一次性取景，镜头固定
    let overviewCam: CameraState | null = null;
    if (overview) {
      const bb = lineBounds(animLine);
      const c = engine.map.cameraForBounds(bb, { padding: 110, bearing: 0, pitch: 25 });
      const oc = c?.center ? lngLatOf(c.center) : null;
      overviewCam = {
        center: oc ?? fromPos(stop),
        zoom: c?.zoom ?? 5,
        bearing: 0,
        pitch: 25,
      };
    }

    // 段前 700ms 场记停留：镜头不动、无载具（同 playTrip）
    shots.push({ startMs: t, shot: { type: "segment", index: i + 1, segment: seg, stop, nextStop: next, day: stop.day } });
    spans.push(staticSpan(t, t + SEG_SLATE_MS, stopCam, lastTraveled));
    t += SEG_SLATE_MS;

    // 先拉远（同 playTrip 的段前镜头）：镜头从特写拉到本段取景，
    // 载具与轨迹在此之后才出现；拉远目标即行驶镜头起点，移动中不再叠加拉远。
    // 拉远段起已清掉上一段的已行驶红线（同 playTrip），此处 traveled 为 null
    const departCam: CameraState = useGlobe
      ? { center: fromPos(stop), zoom: 4.5, bearing: 0, pitch: 30 }
      : air
        ? { center: fromPos(stop), zoom: zoomForDistance(distanceM, stop.latitude, vpMin), bearing: 0, pitch: 30 }
        : overview
          ? overviewCam!
          : { center: fromPos(stop), zoom: followZoom, bearing: 0, pitch: 42 };
    const departMs = overview ? SEG_DEPART_FAR_MS : SEG_DEPART_MS;
    const departStart = t;
    spans.push({
      start: departStart, end: departStart + departMs,
      projection: useGlobe ? "globe" : "mercator",
      camera: (now) =>
        lerpCam(stopCam, departCam, easeInOut(Math.min(1, (now - departStart) / departMs))),
      vehicle: () => null,
      traveled: () => null,
    });
    t += departMs;

    const animStart = t;
    const camAt = (t01: number, pt: [number, number], bearing: number): CameraState => {
      if (useGlobe) return { center: pt, zoom: 4.5, bearing: 0, pitch: 30 };
      if (air) return { center: pt, zoom: zoomForDistance(distanceM, pt[1], vpMin), bearing: 0, pitch: 30 };
      if (overview) return overviewCam!;
      return cameraForDrive(pt, bearing, t01, stop, next, followZoom);
    };
    spans.push({
      start: animStart, end: animStart + durationMs, projection: useGlobe ? "globe" : "mercator",
      camera: (now) => {
        const t01 = Math.min(1, (now - animStart) / durationMs);
        const s = sampleAlongLine(animLine, t01);
        return camAt(t01, s.point, s.bearing);
      },
      vehicle: (now) => {
        const t01 = Math.min(1, (now - animStart) / durationMs);
        const s = sampleAlongLine(animLine, t01);
        return { point: s.point, heading, transport: seg.transport, distM: distanceM * t01 };
      },
      traveled: (now) =>
        sampleAlongLine(animLine, Math.min(1, (now - animStart) / durationMs)).traveled,
    });
    prevCam = camAt(1, animLine[animLine.length - 1], 0);
    lastTraveled = animLine;
    t += durationMs;
  }

  const totalMs = t;
  const spanAt = (tMs: number) => {
    const x = Math.max(0, Math.min(totalMs - 1, tMs));
    for (let i = spans.length - 1; i >= 0; i--) {
      if (spans[i].start <= x) return spans[i];
    }
    return spans[0];
  };

  return {
    totalMs,
    shots,
    cameraAt: (tMs) => spanAt(tMs).camera(tMs),
    vehicleAt: (tMs) => spanAt(tMs).vehicle(tMs),
    traveledAt: (tMs) => spanAt(tMs).traveled(tMs),
    projectionAt: (tMs) => spanAt(tMs).projection,
  };
}

function lineBounds(line: [number, number][]): [[number, number], [number, number]] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of line) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

/** LngLatLike（数组 / {lng,lat} / {lon,lat}）→ [lng, lat] */
function lngLatOf(v: unknown): [number, number] | null {
  if (Array.isArray(v)) return [v[0], v[1]];
  if (v && typeof v === "object") {
    const o = v as { lng?: number; lat?: number; lon?: number };
    const lng = o.lng ?? o.lon;
    if (typeof lng === "number" && typeof o.lat === "number") return [lng, o.lat];
  }
  return null;
}
