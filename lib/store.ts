// ============================================================
// Travel Story — 数据层
//
// 存储架构（v2，已上轻量后端）：
//   - 权威数据在服务端的 data/trips.json（/api/trips，整库读写）；
//   - localStorage 降级为「秒开缓存 + 离线兜底」：首帧同步读本地，
//     首次订阅时从服务端拉最新数据覆盖；每次写入先落本地、再防抖
//     推送到服务端。服务端连不上时应用照常离线工作。
//   - 旧版本（纯 localStorage 时代）的数据在服务端为空时自动迁移上去。
//
// Repository 函数仍是唯一入口，外部组件不直接触碰存储格式。
// ============================================================

import { TRANSPORT_KIND } from "./types";
import type { MediaMeta, Transport, Trip, TripDay, TripSegment, TripStop } from "./types";

const STORAGE_KEY = "travel-story:v1";
export const DEFAULT_TRANSPORT: Transport = "car";

interface DB {
  seeded: boolean;
  trips: Trip[];
}

let cache: DB | null = null;
const listeners = new Set<() => void>();

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function loadDB(): DB {
  if (cache) return cache;
  if (typeof window === "undefined") {
    // SSR：返回空快照，不触碰 localStorage
    cache = { seeded: false, trips: [] };
    return cache;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      cache = { seeded: !!parsed.seeded, trips: (parsed.trips || []).map(normalizeTrip) };
      return cache;
    }
  } catch (e) {
    console.warn("[travel-story] localStorage 读取失败，重新初始化", e);
  }
  cache = { seeded: false, trips: [] };
  return cache;
}

function saveDB() {
  if (!cache) return;
  // 关键：每次写入都生成新的 trips 数组引用。
  // useSyncExternalStore 用 Object.is(新快照, 旧快照) 判断是否变更，
  // 原地改数组会返回同一引用，导致 UI 永不重渲染。
  cache = { ...cache, trips: cache.trips.slice() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn("[travel-story] 写入 localStorage 失败", e);
  }
  schedulePush();
}

// ------------------------------------------------------------
// 服务端同步
// ------------------------------------------------------------

/** 首次拉取期间本地又产生了写入 → 不用服务端的旧数据覆盖本地 */
let dirtySinceSync = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** 防抖推送整库到服务端（本地写入已生效，推送失败不影响使用） */
function schedulePush() {
  dirtySinceSync = true;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(pushToServer, 400);
}

async function pushToServer() {
  if (!cache) return;
  const body = JSON.stringify(cache);
  try {
    const res = await fetch("/api/trips", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok) dirtySinceSync = false;
  } catch (e) {
    console.warn("[travel-story] 推送服务端失败（数据仍在本地）", e);
  }
}

/**
 * 首次订阅时从服务端拉取权威数据：
 *  - 服务端有数据 → 覆盖本地缓存并通知所有组件；
 *  - 服务端为空但本地有数据 → 把本地数据迁移上去（旧版本平滑过渡）；
 *  - 拉取期间本地有写入则放弃覆盖，改为推送本地版本。
 */
async function syncFromServer() {
  try {
    const res = await fetch("/api/trips");
    if (!res.ok) return;
    const server = (await res.json()) as { trips?: unknown[] };
    const serverTrips = Array.isArray(server.trips) ? server.trips : [];
    if (dirtySinceSync) return;
    if (serverTrips.length > 0) {
      cache = {
        seeded: true,
        trips: (serverTrips as Trip[]).map(normalizeTrip),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
      } catch {}
      emit();
    } else if (cache && cache.trips.length > 0) {
      // 迁移：本地有旧数据，服务端为空 → 推上去
      schedulePush();
    }
  } catch (e) {
    console.warn("[travel-story] 服务端拉取失败，使用本地缓存", e);
  }
}

let syncPromise: Promise<void> | null = null;

function startSync() {
  if (!syncPromise && typeof window !== "undefined") {
    syncPromise = syncFromServer();
  }
}

/** 等首次服务端同步完成（成败都 resolve）。seed 等写库操作必须先等它，
 *  否则「服务端有数据 + 全新浏览器」时本地抢先写入会顶掉服务端数据。 */
export function whenSynced(): Promise<void> {
  startSync();
  return syncPromise ?? Promise.resolve();
}

function emit() {
  listeners.forEach((l) => l());
}

/** React 订阅：任意组件可 useStore() 获取快照并在变更时重渲染 */
export function subscribe(listener: () => void) {
  listeners.add(listener);
  // 第一个订阅者出现时触发服务端同步（此时一定在客户端）
  startSync();
  return () => listeners.delete(listener);
}

export function getSnapshot(): Trip[] {
  return loadDB().trips;
}

// ------------------------------------------------------------
// 归一化：保证数据不变量
// ------------------------------------------------------------

/**
 * 重建一个 Trip 的内部一致性：
 *  - days 按 day 号排序，并重编号为 1..N（删掉第一天后，第二天变第一天）；
 *  - stops 按 (day, order) 排序并重写全局 day/order；
 *  - segments 在相邻 stops 之间重建，保留已有段的路由缓存与交通方式。
 */
export function normalizeTrip(trip: Trip): Trip {
  const days = [...trip.days].sort((a, b) => a.day - b.day);
  const stops = [...trip.stops].sort((a, b) => a.day - b.day || a.order - b.order);

  // 重编号 day 与全局顺序
  const dayIndex = new Map(days.map((d, i) => [d.id, i + 1]));
  days.forEach((d, i) => {
    d.day = i + 1;
  });
  stops.forEach((s, i) => {
    s.day = dayIndex.get(s.dayId) ?? 1;
    s.order = i;
  });

  // 重建 segments，保留已有路由
  const oldSegments = new Map(trip.segments.map((seg) => [seg.fromStopId, seg]));
  const segments: TripSegment[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    const old = oldSegments.get(from.id);
    const transport = old?.transport ?? DEFAULT_TRANSPORT;
    // 迁移：旧版本可能把 OSRM 失败时的兜底直线（仅 2 点）缓存成了道路路线，
    // 这会在地图上画出误导性直线。陆路/步行/铁路的 2 点直线一律丢弃重取；
    // 飞机（大圆，64 点）与轮船（本就是直线）保留。
    const kind = TRANSPORT_KIND[transport];
    const cachedRoute = old?.route ?? null;
    const isBadFallback =
      cachedRoute &&
      cachedRoute.coordinates.length === 2 &&
      kind !== "air" &&
      kind !== "water";
    segments.push({
      id: old?.id ?? uid("seg"),
      fromStopId: from.id,
      toStopId: to.id,
      transport,
      route: isBadFallback ? null : cachedRoute,
      distance: isBadFallback ? undefined : old?.distance,
      duration: isBadFallback ? undefined : old?.duration,
    });
  }

  return { ...trip, days, stops, segments };
}

// ------------------------------------------------------------
// 旅行 CRUD
// ------------------------------------------------------------

export function createTrip(input: {
  name: string;
  startDate: string;
  endDate: string;
  origin?: string;
  region?: string;
  description?: string;
  isPublic?: boolean;
}): Trip {
  const db = loadDB();
  const now = Date.now();
  const trip: Trip = normalizeTrip({
    id: uid("trip"),
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    origin: input.origin,
    region: input.region,
    description: input.description,
    isPublic: input.isPublic ?? false,
    coverHue: Math.floor(Math.random() * 360),
    createdAt: now,
    days: [createDayFor(1, input.startDate)],
    stops: [],
    segments: [],
  });
  db.trips.unshift(trip);
  saveDB();
  emit();
  return trip;
}

function createDayFor(day: number, date: string): TripDay {
  return { id: uid("day"), day, date };
}

export function updateTrip(id: string, patch: Partial<Trip>) {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === id);
  if (!trip) return;
  const merged = normalizeTrip({ ...trip, ...patch });
  db.trips[db.trips.indexOf(trip)] = merged;
  saveDB();
  emit();
}

export function deleteTrip(id: string) {
  const db = loadDB();
  db.trips = db.trips.filter((t) => t.id !== id);
  saveDB();
  emit();
}

export function getTrip(id: string): Trip | null {
  return loadDB().trips.find((t) => t.id === id) ?? null;
}

// ------------------------------------------------------------
// Day 操作
// ------------------------------------------------------------

export function addDay(tripId: string): Trip {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return trip!;
  const lastDay = trip.days[trip.days.length - 1];
  const nextDayNum = (lastDay?.day ?? 0) + 1;
  const nextDate = addDays(lastDay?.date ?? trip.startDate, 1);
  trip.days.push({ id: uid("day"), day: nextDayNum, date: nextDate });
  const merged = normalizeTrip(trip);
  db.trips[db.trips.indexOf(trip)] = merged;
  saveDB();
  emit();
  return merged;
}

export function removeDay(tripId: string, dayId: string) {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return;
  const day = trip.days.find((d) => d.id === dayId);
  if (!day || trip.days.length <= 1) return; // 至少保留 1 天
  trip.days = trip.days.filter((d) => d.id !== dayId);
  trip.stops = trip.stops.filter((s) => s.dayId !== dayId);
  const merged = normalizeTrip(trip);
  db.trips[db.trips.indexOf(trip)] = merged;
  saveDB();
  emit();
}

// ------------------------------------------------------------
// Trip Stop 操作
// ------------------------------------------------------------

export function addStop(
  tripId: string,
  dayId: string,
  input: Omit<TripStop, "id" | "dayId" | "day" | "order">
): Trip {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return trip!;
  const day = trip.days.find((d) => d.id === dayId);
  if (!day) return trip;
  const dayStops = trip.stops.filter((s) => s.dayId === dayId);
  const stop: TripStop = {
    ...input,
    id: uid("stop"),
    dayId,
    day: day.day,
    // 新地点排在该 Day 最下面。order 必须超过本 Day 现有最大值——
    // normalizeTrip 会把 order 改写成全局序号，用 dayStops.length 会
    // 和其他 Day 占用的序号撞车，导致新地点被排序到中间甚至顶部。
    order: Math.max(-1, ...dayStops.map((s) => s.order)) + 1,
  };
  trip.stops.push(stop);
  const merged = normalizeTrip(trip);
  db.trips[db.trips.indexOf(trip)] = merged;
  saveDB();
  emit();
  return merged;
}

export function removeStop(tripId: string, stopId: string) {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return;
  trip.stops = trip.stops.filter((s) => s.id !== stopId);
  const merged = normalizeTrip(trip);
  db.trips[db.trips.indexOf(trip)] = merged;
  saveDB();
  emit();
}

/**
 * 移动 stop：支持跨 Day。
 * targetDayId 省略时表示在 stops 全局有序列表中的目标索引。
 */
export function moveStop(
  tripId: string,
  stopId: string,
  targetDayId: string | null,
  targetIndexInDay: number
) {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return;
  const stop = trip.stops.find((s) => s.id === stopId);
  if (!stop) return;

  if (targetDayId) stop.dayId = targetDayId;

  const dayStops = trip.stops.filter((s) => s.dayId === stop.dayId);
  const idx = dayStops.findIndex((s) => s.id === stopId);
  dayStops.splice(idx, 1);
  dayStops.splice(Math.min(targetIndexInDay, dayStops.length), 0, stop);
  dayStops.forEach((s, i) => (s.order = i));

  const merged = normalizeTrip(trip);
  db.trips[db.trips.indexOf(trip)] = merged;
  saveDB();
  emit();
}

export function setStopTransport(tripId: string, fromStopId: string, transport: Transport) {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return;
  const seg = trip.segments.find((s) => s.fromStopId === fromStopId);
  if (!seg) return;
  seg.transport = transport;
  // 交通方式变化后路由需重新获取
  seg.route = null;
  saveDB();
  emit();
}

// ------------------------------------------------------------
// 地点素材（图片/视频元数据；二进制在 IndexedDB，见 lib/media.ts）
// ------------------------------------------------------------

export function addStopMedia(tripId: string, stopId: string, meta: MediaMeta) {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return;
  const stop = trip.stops.find((s) => s.id === stopId);
  if (!stop) return;
  stop.media = [...(stop.media ?? []), meta];
  const merged = normalizeTrip(trip);
  db.trips[db.trips.indexOf(trip)] = merged;
  saveDB();
  emit();
}

export function removeStopMedia(tripId: string, stopId: string, mediaId: string) {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return;
  const stop = trip.stops.find((s) => s.id === stopId);
  if (!stop) return;
  stop.media = (stop.media ?? []).filter((m) => m.id !== mediaId);
  const merged = normalizeTrip(trip);
  db.trips[db.trips.indexOf(trip)] = merged;
  saveDB();
  emit();
}

export function setSegmentRoute(tripId: string, fromStopId: string, route: TripSegment) {
  const db = loadDB();
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) return;
  const seg = trip.segments.find((s) => s.fromStopId === fromStopId);
  if (!seg) return;
  seg.route = route.route;
  seg.distance = route.distance;
  seg.duration = route.duration;
  saveDB();
}

// ------------------------------------------------------------
// 工具
// ------------------------------------------------------------

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function formatDateCN(dateStr: string): string {
  if (!dateStr) return "";
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** 获取某 trip 按 day 分组的 stops（顺序已归一化） */
export function stopsByDay(trip: Trip): Map<string, TripStop[]> {
  const map = new Map<string, TripStop[]>();
  for (const stop of trip.stops) {
    const list = map.get(stop.dayId) ?? [];
    list.push(stop);
    map.set(stop.dayId, list);
  }
  return map;
}

/** 总天数（可能无 days 数据，回退到日期差） */
export function tripDays(trip: Trip): number {
  if (trip.days.length) return trip.days.length;
  const s = new Date(`${trip.startDate}T00:00:00`);
  const e = new Date(`${trip.endDate}T00:00:00`);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}
