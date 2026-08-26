// ============================================================
// Travel Story — 服务端持久化（仅服务端可用）
//
// 轻量后端的存储层：项目根 data/ 目录下的平面文件。
//   data/trips.json      全部行程（整库读写，单用户量级足够）
//   data/media/<id>      素材二进制（图片/视频）+ <id>.json 元数据
//   data/recordings/     生成的纪录片视频
// 行程写库用「写临时文件 + rename」保证原子性，防止中途断电写坏。
// 将来换 PostgreSQL/S3 时只改这一层，API 路由不动。
// ============================================================

import { promises as fs } from "fs";
import { randomUUID } from "node:crypto";
import path from "path";

export const DATA_DIR = path.join(process.cwd(), "data");
const TRIPS_FILE = path.join(DATA_DIR, "trips.json");
const MEDIA_DIR = path.join(DATA_DIR, "media");
export const RECORDINGS_DIR = path.join(DATA_DIR, "recordings");

async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

export async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
}

// ------------------------------------------------------------
// 行程库（整库 JSON）
// ------------------------------------------------------------

export async function readTripsDB(): Promise<{ trips: unknown[] }> {
  try {
    const raw = await fs.readFile(TRIPS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return { trips: Array.isArray(parsed.trips) ? parsed.trips : [] };
  } catch {
    return { trips: [] };
  }
}

export async function writeTripsDB(db: { trips: unknown[] }): Promise<void> {
  await ensureDirs();
  await writeFileAtomic(TRIPS_FILE, JSON.stringify(db));
}

// ------------------------------------------------------------
// 素材二进制
// ------------------------------------------------------------

export interface MediaSidecar {
  contentType: string;
  name: string;
}

const safeId = (id: string) => {
  // 只允许字母数字下划线连字符，防目录穿越
  if (!/^[\w-]+$/.test(id)) throw new Error(`非法素材 id: ${id}`);
  return id;
};

export function mediaPath(id: string) {
  return path.join(MEDIA_DIR, safeId(id));
}

function sidecarPath(id: string) {
  return path.join(MEDIA_DIR, `${safeId(id)}.json`);
}

export async function writeMedia(id: string, buf: Buffer, meta: MediaSidecar): Promise<void> {
  await ensureDirs();
  await writeFileAtomic(mediaPath(id), buf);
  await writeFileAtomic(sidecarPath(id), JSON.stringify(meta));
}

export async function readMedia(
  id: string
): Promise<{ buf: Buffer; meta: MediaSidecar } | null> {
  try {
    const buf = await fs.readFile(mediaPath(id));
    let meta: MediaSidecar = { contentType: "application/octet-stream", name: id };
    try {
      meta = JSON.parse(await fs.readFile(sidecarPath(id), "utf-8"));
    } catch {
      // 元数据丢了也能出流
    }
    return { buf, meta };
  } catch {
    return null;
  }
}

export async function deleteMedia(id: string): Promise<void> {
  await fs.unlink(mediaPath(id)).catch(() => {});
  await fs.unlink(sidecarPath(id)).catch(() => {});
}
