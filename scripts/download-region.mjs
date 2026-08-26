#!/usr/bin/env node
// ============================================================
// Travel Story — 区域瓦片批量下载（灌进本地磁盘缓存）
//
// 不想下 95GB 整球包时的轻量方案：只下指定范围。下载结果与
// /api/tiles 的懒缓存完全同构（tile-cache/planet/{build}/{z}/{x}/{y}.pbf），
// 两者可混用——批量没覆盖到的地方，浏览时会自动回源补缓存。
//
// 用法：
//   node scripts/download-region.mjs --bbox 73,3,135,54 --zmax 12      # 全中国到 z12
//   node scripts/download-region.mjs --bbox 2.2,48.7,2.6,49.0 --zmax 14
//   node scripts/download-region.mjs --bbox ... --zmax ... --yes       # 超过 3000 片需确认
//
// 速度参考：单请求 0.5~2s、并发 8 → 每分钟约 300~600 片。
// 中国 z0-12 约 1~2 万片（几十分钟），z0-14 约 20 万+ 片（不建议）。
// ============================================================

import { promises as fs } from "node:fs";
import path from "node:path";

const UPSTREAM = "https://tiles.openfreemap.org";
const CONCURRENCY = 8;
const CONFIRM_OVER = 3000;

// ------------------------------------------------------------
// 参数
// ------------------------------------------------------------

const args = process.argv.slice(2);
function opt(name) {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : null;
}
const bbox = (opt("bbox") || "").split(",").map(Number);
const zmin = Number(opt("zmin") ?? 3);
const zmax = Number(opt("zmax") ?? 12);
const assumeYes = args.includes("--yes");

if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
  console.error("用法: node scripts/download-region.mjs --bbox 西,南,东,北 [--zmin 3] [--zmax 12] [--yes]");
  process.exit(1);
}
const [west, south, east, north] = bbox;
if (zmax > 14) {
  console.error("zmax 最大 14（数据源 maxzoom）");
  process.exit(1);
}

const CACHE_DIR = path.join(process.cwd(), "tile-cache");

// ------------------------------------------------------------
// 瓦片坐标（slippy）
// ------------------------------------------------------------

const lng2x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

// ------------------------------------------------------------
// 主流程
// ------------------------------------------------------------

// 从源站 TileJSON 学构建号，保证缓存路径与代理懒缓存一致
const tj = await (await fetch(`${UPSTREAM}/planet`)).json();
const tpl = tj.tiles[0]; // https://tiles.openfreemap.org/planet/{build}/{z}/{x}/{y}.pbf
console.log("瓦片模板:", tpl);

const tasks = [];
for (let z = zmin; z <= zmax; z++) {
  const n = 2 ** z;
  const x0 = Math.max(0, lng2x(west, z));
  const x1 = Math.min(n - 1, lng2x(east, z));
  const y0 = Math.max(0, lat2y(north, z)); // 北 → 小号 y
  const y1 = Math.min(n - 1, lat2y(south, z));
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tasks.push([z, x, y]);
}
console.log(`共 ${tasks.length} 片（z${zmin}~z${zmax}）`);

if (tasks.length > CONFIRM_OVER && !assumeYes) {
  console.error(`超过 ${CONFIRM_OVER} 片，确认要下载请加 --yes`);
  process.exit(1);
}

let done = 0, skipped = 0, failed = 0;
const started = Date.now();
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (tasks.length) {
      const [z, x, y] = tasks.shift();
      const rel = tpl.replace(`${UPSTREAM}/`, "").replace("{z}", z).replace("{x}", x).replace("{y}", y);
      const file = path.join(CACHE_DIR, rel);
      try {
        await fs.access(file);
        skipped++;
      } catch {
        const ok = await download(rel, file);
        if (ok) done++;
        else failed++;
      }
      const total = done + skipped + failed;
      if (total % 100 === 0) {
        const mins = (Date.now() - started) / 60000;
        console.log(`进度 ${total}：新增 ${done} 跳过 ${skipped} 失败 ${failed}（${(total / mins).toFixed(0)} 片/分）`);
      }
    }
  })
);
console.log(`✓ 完成：新增 ${done}，已有跳过 ${skipped}，失败 ${failed}`);

async function download(rel, file) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(`${UPSTREAM}/${rel}`, { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file + ".tmp", buf);
        await fs.rename(file + ".tmp", file);
        return true;
      }
      if (res.status < 500) return false;
    } catch {
      /* 重试 */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return false;
}
