// ============================================================
// Travel Story — 路线服务（RoutingProvider 抽象）
//
// 遵循需求文档 §46：路线与 Provider 分离，绝不在业务代码里写死
// 某个路由服务。实现三个 Provider：
//
//   OSRMProvider  —— 真实道路路线（驾车），公开服务无需 key；
//                   注意 demo 服务器只有驾车 profile，foot 实际返回汽车路线；
//   高德 /api/route —— 国内步行/骑行真实路线（服务端代理，见 routing 分派）；
//   DirectProvider—— 直线 / 大圆航线降级（离线、超时、飞机场景）。
//
// 对外暴露单一 `routing` 实例，内部按 transport 分派 + 自动降级。
// ============================================================

import greatCircle from "@turf/great-circle";
import { distance as turfDistance } from "@turf/distance";
import { TRANSPORT_KIND } from "./types";
import type { RouteGeometry, Transport } from "./types";

export interface RouteResult {
  route: RouteGeometry;
  distance: number; // 米
  duration: number; // 秒
  /** true = 真实道路/航线（可缓存显示）；false = 离线兜底直线（不持久化，避免在地图上画误导性直线） */
  authoritative: boolean;
}

export interface RoutingProvider {
  getRoute(from: [number, number], to: [number, number], transport: Transport): Promise<RouteResult>;
}

const OSRM_BASE = "https://router.project-osrm.org/route/v1";

/** OSRM profile：demo 服务器只有 driving，任何 profile 都返回驾车路线 */
function osrmProfile(t: Transport): string {
  void t;
  return "driving";
}

export class OSRMProvider implements RoutingProvider {
  async getRoute(
    from: [number, number],
    to: [number, number],
    transport: Transport
  ): Promise<RouteResult> {
    const profile = osrmProfile(transport);
    const url = `${OSRM_BASE}/${profile}/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const json = await res.json();
      if (json.code !== "Ok" || !json.routes?.length) throw new Error("OSRM no route");
      const r = json.routes[0];
      const coords: [number, number][] = (r.geometry.coordinates as number[][]).map(
        (c) => [c[0], c[1]] as [number, number]
      );
      return { route: { type: "LineString", coordinates: coords }, distance: r.distance, duration: r.duration, authoritative: true };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class DirectProvider implements RoutingProvider {
  constructor(private authoritative = false) {}
  async getRoute(
    from: [number, number],
    to: [number, number],
    transport: Transport
  ): Promise<RouteResult> {
    if (transport === "plane") {
      // 大圆航线（沿球面弧度）
      const gc = greatCircle(from, to, { npoints: 64 });
      const coords: [number, number][] = (gc.geometry.coordinates as number[][]).map(
        (c) => [c[0], c[1]] as [number, number]
      );
      const d = turfDistance(from, to) * 1000;
      return { route: { type: "LineString", coordinates: coords }, distance: d, duration: d / 200, authoritative: this.authoritative };
    }
    // 直线
    const coords: [number, number][] = [from, to];
    const d = turfDistance(from, to) * 1000;
    return { route: { type: "LineString", coordinates: coords }, distance: d, duration: d / 8, authoritative: this.authoritative };
  }
}

const osrm = new OSRMProvider();
// 飞机/轮船的直线/大圆是「正确呈现」，权威；道路降级直线只是兜底，不持久化
const directAuthoritative = new DirectProvider(true);
const directFallback = new DirectProvider(false);

/** 步行/自行车在国内走真实步行/骑行路线（服务端代理高德，见 app/api/route）；
 *  境外或失败时回退 OSRM（注意：OSRM demo 的 foot 实际返回驾车数据） */
const DOMESTIC_PROFILE: Partial<Record<Transport, "walking" | "cycling">> = {
  walk: "walking",
  bicycle: "cycling",
};

async function domesticRoute(
  from: [number, number],
  to: [number, number],
  transport: Transport
): Promise<RouteResult> {
  const profile = DOMESTIC_PROFILE[transport];
  const res = await fetch(
    `/api/route?from=${from[0]},${from[1]}&to=${to[0]},${to[1]}&profile=${profile}`
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return {
    route: json.route,
    distance: json.distance,
    duration: json.duration,
    authoritative: true,
  };
}

export const routing: RoutingProvider = {
  async getRoute(from, to, transport) {
    // 飞机走大圆、轮船走直线（水上无道路），这就是预期路线
    const kind = TRANSPORT_KIND[transport];
    if (kind === "air" || kind === "water") {
      return directAuthoritative.getRoute(from, to, transport);
    }
    // 步行/自行车：先试国内真实步行/骑行路线，失败回退 OSRM（驾车线）
    if (DOMESTIC_PROFILE[transport]) {
      try {
        return await domesticRoute(from, to, transport);
      } catch (e) {
        console.warn("[travel-story] 高德步行/骑行路线不可用，回退 OSRM", e);
      }
    }
    try {
      return await osrm.getRoute(from, to, transport);
    } catch (e) {
      console.warn("[travel-story] OSRM 不可用，降级为直连路线（不持久化）", e);
      return directFallback.getRoute(from, to, transport);
    }
  },
};

// ------------------------------------------------------------
// 几何工具
// ------------------------------------------------------------

/** 距离格式化：不足 1km 用米，否则公里（一位小数）。场记字幕/载具头顶里程用 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** 沿 LineString 按弧长采样点（用于车辆逐帧移动） */
export function sampleAlongLine(
  coords: [number, number][],
  t: number
): { point: [number, number]; bearing: number; traveled: [number, number][] } {
  if (!coords.length) return { point: [0, 0], bearing: 0, traveled: [] };
  if (coords.length === 1) return { point: coords[0], bearing: 0, traveled: coords };

  // 预计算累计弧长（简化：平面距离近似）
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  }
  const total = cum[cum.length - 1];
  const target = Math.max(0, Math.min(1, t)) * total;

  // 找到目标点所在的线段
  let segIdx = 0;
  for (let i = 0; i < cum.length - 1; i++) {
    if (target >= cum[i] && target <= cum[i + 1]) {
      segIdx = i;
      break;
    }
  }
  const segStart = cum[segIdx];
  const segLen = cum[segIdx + 1] - cum[segIdx] || 1;
  const local = (target - segStart) / segLen;
  const a = coords[segIdx];
  const b = coords[segIdx + 1];
  const point: [number, number] = [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];

  const bearing = Math.atan2(b[0] - a[0], b[1] - a[1]) * (180 / Math.PI);

  // 已走过的路径（用于路线逐渐高亮）
  const traveled: [number, number][] = coords.slice(0, segIdx + 1);
  traveled.push(point);
  return { point, bearing, traveled };
}

function dist(a: [number, number], b: [number, number]): number {
  // 球面近似（米），足够用于动画采样
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
