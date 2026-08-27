// ============================================================
// 把 MapLibre GL JS v6 的 worker 及共享 chunk 复制到 public/maplibre/
//
// v6 是 ESM-only，worker 通过 import.meta.url 自解析路径；但 Next.js
// (webpack/Turbopack) 里 import.meta.url 不是有效 http URL，worker 会
// 加载到 HTML 页面而失败 → 矢量瓦片（国际模式）不渲染。
// 官方方案：把 worker 两个文件拷进 public/，客户端 setWorkerUrl 指向它。
//
// 两个文件都要拷：maplibre-gl-worker.mjs 会按相对路径 import
// ./maplibre-gl-shared.mjs，必须同目录。
// 由 package.json 的 predev / prebuild 触发，升级 maplibre 后自动同步。
// ============================================================

import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "node_modules", "maplibre-gl", "dist");
const outDir = path.join(root, "public", "maplibre");

const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

await mkdir(outDir, { recursive: true });
for (const f of files) {
  await copyFile(path.join(dist, f), path.join(outDir, f));
  console.log(`copied ${f} -> public/maplibre/`);
}
