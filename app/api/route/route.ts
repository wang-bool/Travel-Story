// ============================================================
// Travel Story — 步行/骑行路线 API 代理（服务端）
//
//   GET /api/route?from=<lng,lat>&to=<lng,lat>&profile=walking|cycling
//
// 背景：OSRM 公开 demo 只有驾车 profile（foot/bike 都返回汽车路线），
// 步行/自行车想要真实路线（不过江走桥、不闯高速）得另找服务。
// 这里走高德「路径规划」：国内数据最新最准；key 只在服务端，
// 前端不接触。返回前把高德的 GCJ-02 火星坐标还原成 WGS-84。
//
// 只服务国内：任一端点在境外 → 403 让客户端回退旧路（OSRM）。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { gcj02ToWgs84, wgs84ToGcj02, outOfChina } from "@/lib/coord";

export const maxDuration = 30;

// 与 geocode 同款滑动窗口限流：最近 10s 内最多 40 次
const WINDOW_MS = 10_000;
const WINDOW_MAX = 40;
const hits: number[] = [];

function allow(): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0] > WINDOW_MS) hits.shift();
  if (hits.length >= WINDOW_MAX) return false;
  hits.push(now);
  return true;
}

/** 高德折线 "lng,lat;lng,lat;…" → WGS-84 坐标串 */
function parsePolyline(polyline: string): [number, number][] {
  return polyline
    .split(";")
    .map((pair) => {
      const [lng, lat] = pair.split(",").map(Number);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      const wgs = gcj02ToWgs84(lat, lng);
      return [wgs.lon, wgs.lat] as [number, number];
    })
    .filter((c): c is [number, number] => c !== null);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const from = (sp.get("from") ?? "").split(",").map(Number);
  const to = (sp.get("to") ?? "").split(",").map(Number);
  const profile = sp.get("profile") ?? "";
  if (profile !== "walking" && profile !== "cycling") {
    return NextResponse.json({ error: "profile 只支持 walking|cycling" }, { status: 400 });
  }
  if (from.length !== 2 || to.length !== 2 || ![...from, ...to].every(Number.isFinite)) {
    return NextResponse.json({ error: "from/to 参数格式：lng,lat" }, { status: 400 });
  }
  // 只接国内：境外让客户端回退到原有 OSRM 逻辑
  if (outOfChina(from[1], from[0]) || outOfChina(to[1], to[0])) {
    return NextResponse.json({ error: "仅支持国内路线" }, { status: 403 });
  }
  if (!allow()) {
    return NextResponse.json({ error: "rate-limited" }, { status: 429 });
  }
  const key = process.env.GAODE_KEY;
  if (!key) return NextResponse.json({ error: "未配置 GAODE_KEY" }, { status: 503 });

  // 起终点是 WGS-84，高德要 GCJ-02：先转换再请求（返回的折线再转回来）
  const fromGcj = wgs84ToGcj02(from[1], from[0]);
  const toGcj = wgs84ToGcj02(to[1], to[0]);
  const origin = `${fromGcj.lon},${fromGcj.lat}`;
  const destination = `${toGcj.lon},${toGcj.lat}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    if (profile === "walking") {
      // 步行 v3：status="1" 成功，paths[0].steps[].polyline 串成完整折线
      const url = `https://restapi.amap.com/v3/direction/walking?key=${key}&origin=${origin}&destination=${destination}`;
      const json = await (await fetch(url, { signal: controller.signal })).json();
      if (json.status !== "1" || !json.route?.paths?.length) {
        throw new Error(`高德步行规划失败: ${json.info ?? json.status}`);
      }
      const path = json.route.paths[0];
      const coords = (path.steps ?? []).flatMap((s: { polyline?: string }) =>
        s.polyline ? parsePolyline(s.polyline) : []
      );
      if (coords.length < 2) throw new Error("高德步行规划返回空路线");
      return NextResponse.json({
        route: { type: "LineString", coordinates: coords },
        distance: Number(path.distance) || 0,
        duration: Number(path.duration) || 0,
        authoritative: true,
      });
    }
    // 骑行 v4（路径规划 2.0）：errcode=0 成功，结构在 data.paths
    const url = `https://restapi.amap.com/v4/direction/bicycling?key=${key}&origin=${origin}&destination=${destination}`;
    const json = await (await fetch(url, { signal: controller.signal })).json();
    if (json.errcode !== 0 || !json.data?.paths?.length) {
      throw new Error(`高德骑行规划失败: ${json.errmsg ?? json.errcode}`);
    }
    const path = json.data.paths[0];
    const coords = (path.steps ?? []).flatMap((s: { polyline?: string }) =>
      s.polyline ? parsePolyline(s.polyline) : []
    );
    if (coords.length < 2) throw new Error("高德骑行规划返回空路线");
    return NextResponse.json({
      route: { type: "LineString", coordinates: coords },
      distance: Number(path.distance) || 0,
      duration: Number(path.duration) || 0,
      authoritative: true,
    });
  } catch (e) {
    console.error("[route] 高德路径规划失败:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
