// ============================================================
// Travel Story — 地点搜索 API 代理（服务端）
//
// 前端只调这里，不接触任何 key：
//   GET /api/geocode?q=埃菲尔铁塔
//
// key 存在服务端 .env.local（GAODE_KEY / LOCATIONIQ_KEY）。
// 未配置时返回 configured:false，前端据此提示「去配 key」，
// 而不是假装没搜到。
//
// 简单全局限流：防止公共部署时被刷爆免费配额（demo 够用）。
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { searchPlaces, reverseGeocode, hasSearchKeys } from "@/lib/geocode";

// 全局滑动窗口限流：最近 10s 内最多 40 次请求
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

export async function GET(req: NextRequest) {
  // 逆地理：?lat=..&lng=.. → { city?, country? }（足迹统计回填用）
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (req.nextUrl.searchParams.has("lat") && req.nextUrl.searchParams.has("lng")) {
    if (!hasSearchKeys()) {
      return NextResponse.json({ configured: false });
    }
    if (!allow()) {
      return NextResponse.json({ error: "rate-limited" }, { status: 429 });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ configured: true });
    }
    try {
      const r = await reverseGeocode(lat, lng);
      return NextResponse.json({ configured: true, city: r?.city, country: r?.country });
    } catch (e) {
      console.error("[geocode] reverse failed:", e);
      return NextResponse.json({ configured: true, error: "reverse-failed" }, { status: 502 });
    }
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > 60) return NextResponse.json({ results: [], configured: hasSearchKeys() });

  if (!hasSearchKeys()) {
    return NextResponse.json({ results: [], configured: false });
  }

  if (!allow()) {
    return NextResponse.json({ results: [], error: "rate-limited" }, { status: 429 });
  }

  try {
    const results = await searchPlaces(q);
    return NextResponse.json({ results, configured: true });
  } catch (e) {
    console.error("[geocode] search failed:", e);
    // 宁可空结果也不要 500 卡死前端
    return NextResponse.json({ results: [], error: "search-failed" }, { status: 502 });
  }
}
