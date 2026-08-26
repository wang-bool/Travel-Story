// ============================================================
// Travel Story — 本地瓦片代理（三级取数）
//
// 「国际」模式的矢量瓦片/字体一律经过这里，不回源直连：
//
//   GET /api/tiles/planet                                  → TileJSON（tiles[] 改写为本代理）
//   GET /api/tiles/planet/{build}/{z}/{x}/{y}.pbf          → 矢量瓦片
//   GET /api/tiles/fonts/{fontstack}/{range}.pbf           → 字体 glyphs
//
// 取数优先级：
//   1. 磁盘散片缓存  tile-cache/<原始路径>      （浏览/预热沉淀，永久有效）
//   2. 本地整球包    tile-cache/planet.mbtiles  （scripts/download-planet.sh
//      一次性下载 ~95GB 放进来，等于全球瞬间「全缓存」；MBTiles 的
//      tile_row 是 TMS 编号，读取时翻转 Y）
//   3. 回源          tiles.openfreemap.org      （成功后写入磁盘散片缓存）
//
// TileJSON 特殊处理：缓存原始版本 24h，回源失败用陈旧缓存兜底（离线
// 也能开图）；返回前把 tiles[] 的源站域名改写成当前 origin。
// ============================================================

import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { TILES_UPSTREAM } from "@/lib/map/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_DIR = path.join(process.cwd(), "tile-cache");
const MBTILES_PATH = path.join(CACHE_DIR, "planet.mbtiles");
const TILEJSON_CACHE = path.join(CACHE_DIR, "_tilejson.json");
const TILEJSON_TTL_MS = 24 * 3600 * 1000;

const H_PBF: HeadersInit = {
  "Content-Type": "application/x-protobuf",
  "Cache-Control": "public, max-age=31536000, immutable",
};

// ------------------------------------------------------------
// 入口
// ------------------------------------------------------------

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  const rel = segs.join("/"); // Next 已解码（如 "fonts/Noto Sans Bold/0-255.pbf"）
  if (!rel || rel.includes("..") || rel.includes("\\")) {
    return new Response("bad path", { status: 400 });
  }
  const origin = req.nextUrl.origin;

  if (rel === "planet") return serveTileJSON(origin);
  if (rel.endsWith(".pbf")) return servePbf(rel);
  return new Response("not found", { status: 404 });
}

// ------------------------------------------------------------
// 瓦片 / 字体：磁盘 → MBTiles（仅瓦片）→ 回源
// ------------------------------------------------------------

async function servePbf(rel: string): Promise<Response> {
  // 1. 磁盘散片缓存
  const file = path.join(CACHE_DIR, rel);
  const cached = await readFileSafe(file);
  if (cached) return new Response(new Uint8Array(cached), { headers: H_PBF });

  // 2. 本地整球 MBTiles（仅 planet/{build}/{z}/{x}/{y}.pbf 形态）
  const m = /^planet\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(rel);
  if (m) {
    const fromDb = mbtilesTile(Number(m[1]), Number(m[2]), Number(m[3]));
    if (fromDb) {
      // MBTiles 里的 tile_data 通常带 gzip；原样返回并声明编码，省 CPU
      const gz = fromDb[0] === 0x1f && fromDb[1] === 0x8b;
      return new Response(new Uint8Array(fromDb), {
        headers: gz ? { ...H_PBF, "Content-Encoding": "gzip" } : H_PBF,
      });
    }
  }

  // 3. 回源（在飞请求去重；成功后写磁盘）
  const data = await fetchUpstreamDeduped(rel);
  if (!data) return new Response("upstream failed", { status: 502 });
  return new Response(new Uint8Array(data), { headers: H_PBF });
}

const inflight = new Map<string, Promise<Buffer | null>>();

function fetchUpstreamDeduped(rel: string): Promise<Buffer | null> {
  const pending = inflight.get(rel);
  if (pending) return pending;
  const p = (async () => {
    const data = await fetchUpstream(rel);
    if (data) await writeFileAtomic(path.join(CACHE_DIR, rel), data);
    inflight.delete(rel);
    return data;
  })();
  inflight.set(rel, p);
  return p;
}

async function fetchUpstream(rel: string, retry = 1): Promise<Buffer | null> {
  const url = new URL(rel, TILES_UPSTREAM + "/"); // URL 构造器自动编码空格等
  for (let i = 0; i <= retry; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status < 500) return null; // 4xx 是请求问题，不重试不缓存
    } catch {
      /* 网络错误走重试 */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

// ------------------------------------------------------------
// TileJSON：缓存 24h，回源失败用陈旧缓存；tiles[] 改写为本代理
// ------------------------------------------------------------

async function serveTileJSON(origin: string): Promise<Response> {
  let raw = await readFileSafe(TILEJSON_CACHE);
  let stale = true;
  if (raw) {
    try {
      stale = Date.now() - (await fs.stat(TILEJSON_CACHE)).mtimeMs >= TILEJSON_TTL_MS;
    } catch {
      /* stat 失败按陈旧处理 */
    }
  }

  // 无缓存或已陈旧 → 回源刷新；回源失败则继续用陈旧缓存兜底（离线也能开图）
  if (!raw || stale) {
    const fetched = await fetchUpstream("planet");
    if (fetched) {
      raw = fetched;
      await writeFileAtomic(TILEJSON_CACHE, fetched);
    }
  }
  if (!raw) return new Response("upstream failed", { status: 502 });

  try {
    const json = JSON.parse(raw.toString("utf8"));
    if (Array.isArray(json.tiles)) {
      json.tiles = json.tiles.map((u: string) => u.replace(TILES_UPSTREAM, origin + "/api/tiles"));
    }
    return new Response(JSON.stringify(json), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new Response("bad tilejson", { status: 502 });
  }
}

// ------------------------------------------------------------
// MBTiles（node:sqlite，懒打开；文件不存在/打不开则永久跳过）
// ------------------------------------------------------------

let db: DatabaseSync | null | undefined;

function mbtilesTile(z: number, x: number, y: number): Buffer | null {
  if (db === undefined) {
    try {
      db = new DatabaseSync(MBTILES_PATH, { readOnly: true });
    } catch {
      db = null; // 没下载整球包，属正常
    }
  }
  if (!db) return null;
  try {
    // MBTiles 的 tile_row 是 TMS（Y 翻转）
    const row = db
      .prepare("SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?")
      .get(z, x, 2 ** z - 1 - y) as { tile_data?: Buffer } | undefined;
    const data = row?.tile_data;
    return data ? Buffer.from(data) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// 小工具
// ------------------------------------------------------------

async function readFileSafe(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

/** tmp + rename，避免中途崩溃留下半个文件被永久当作缓存 */
async function writeFileAtomic(file: string, data: Buffer) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch {
    /* 写缓存失败不影响响应 */
  }
}
