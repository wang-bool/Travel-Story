// ============================================================
// Travel Story — 站点周边瓦片预热（Prefetcher）
//
// 用户浏览地图，绝大多数时候看的是行程站点周边。行程加载后
// 趁闲时把各站点周边瓦片提前经本地代理（/api/tiles）拉一遍，
// 代理会把它们沉淀进项目磁盘缓存（tile-cache/），之后浏览/播放
// 命中本地磁盘，秒开、无白块。
//
// 最佳努力、自我克制：
//  - 首屏安定后（3s）+ 浏览器空闲时才运行；
//  - 本次会话已拉过的跳过；总量封顶 MAX_TILES，低 zoom 优先；
//  - 并发 4，与正常浏览拉瓦片的量级相当，不给 OpenFreeMap 添堵。
// ============================================================

import type { TripStop } from "@/lib/types";

const TILEJSON_URL = "/api/tiles/planet"; // 本地代理（返回的 tiles[] 同为代理 URL）
const MAX_TILES = 600;
const CONCURRENCY = 4;
/** 每个站点预热的 [zoom, 半径(格)]：z10-11 5×5，z12-14 3×3（z15 由 z14 过度放大覆盖） */
const ZOOM_PLAN: ReadonlyArray<readonly [number, number]> = [
  [10, 2],
  [11, 2],
  [12, 1],
  [13, 1],
  [14, 1],
];

let template: string | null = null;
let lastSignature = "";
const fetchedThisSession = new Set<string>();

/** 行程加载后调用；站点未移动时重复调用自动跳过 */
export function prefetchAroundStops(stops: TripStop[]) {
  if (typeof window === "undefined") return;
  if (!stops.length || navigator.onLine === false) return;
  // 省流量模式不预热
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;

  const sig = stops.map((s) => `${s.longitude.toFixed(3)},${s.latitude.toFixed(3)}`).join("|");
  if (sig === lastSignature) return;
  lastSignature = sig;

  // 延迟 3s 让首屏瓦片先拉完，再闲时预热，不与交互抢带宽
  setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => void runPrefetch(stops).catch(() => {}), { timeout: 8000 });
    } else {
      void runPrefetch(stops).catch(() => {});
    }
  }, 3000);
}

async function runPrefetch(stops: TripStop[]) {
  const tpl = await tileTemplate();
  if (!tpl) return;

  // 按 zoom 升序铺开：先所有站点的低 zoom，再逐级补高 zoom
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const [z, r] of ZOOM_PLAN) {
    for (const s of stops) {
      const cx = lng2x(s.longitude, z);
      const cy = lat2y(s.latitude, z);
      const n = 2 ** z;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const u = tpl
            .replace("{z}", String(z))
            .replace("{x}", String(x))
            .replace("{y}", String(y));
          if (!seen.has(u) && !fetchedThisSession.has(u)) {
            seen.add(u);
            urls.push(u);
          }
        }
      }
    }
  }

  const queue = urls.slice(0, MAX_TILES);
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const u = queue.shift()!;
        try {
          await fetch(u); // 经本地代理落入磁盘缓存（已缓存则代理直接读盘，开销极小）
          fetchedThisSession.add(u);
        } catch {
          /* 预热是最佳努力，失败忽略 */
        }
      }
    })
  );
}

/** 从代理 TileJSON 取真实瓦片 URL 模板（含构建号，构建轮换时自动跟随） */
async function tileTemplate(): Promise<string | null> {
  if (template) return template;
  try {
    const res = await fetch(TILEJSON_URL);
    const json = await res.json();
    template = (json?.tiles?.[0] as string) ?? null;
  } catch {
    template = null;
  }
  return template;
}

function lng2x(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function lat2y(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
