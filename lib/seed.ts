// ============================================================
// Travel Story — 首次加载示例数据
//
// 需求文档 §41「第一个验证 Demo」：上海四日游
//   Day 1 东方明珠 → Day 2 外滩 → Day 3 上海动物园 → Day 4 滴水湖
// 坐标取自精选地点表；路段交通方式预置为 car，真实道路路线在
// 规划页打开时异步拉取（见 PlanView 的 effect）。
// ============================================================

import { createTrip, addDay, addStop, getSnapshot } from "./store";
import type { StopType } from "./types";

export function seedIfEmpty(): boolean {
  const trips = getSnapshot();
  if (trips.length > 0) return false;

  const trip = createTrip({
    name: "上海四日游",
    startDate: "2026-10-01",
    endDate: "2026-10-04",
    origin: "本地出发",
    region: "中国 · 上海",
    description:
      "从陆家嘴的天际线到外滩的万国建筑，从西郊的自然生机到临港的湖光。一座城市，四天，四个上海。",
    isPublic: false,
  });

  // createTrip 只建第 1 天；按日期范围补齐 Day 2-4（10-02 ~ 10-04），
  // 否则后面 addStop 找不到对应 dayId 会被静默跳过。
  let current = trip;
  for (let d = 0; d < 3; d++) {
    current = addDay(current.id);
  }
  const dayIds = current.days.map((d) => d.id);

  const places: Array<{
    name: string;
    lat: number;
    lon: number;
    type: StopType;
    city: string;
    country: string;
    day: number;
  }> = [
    {
      name: "东方明珠",
      lat: 31.2419,
      lon: 121.4953,
      type: "attraction",
      city: "上海",
      country: "中国",
      day: 1,
    },
    {
      name: "外滩",
      lat: 31.2397,
      lon: 121.4904,
      type: "scenic",
      city: "上海",
      country: "中国",
      day: 2,
    },
    {
      name: "上海动物园",
      lat: 31.1964,
      lon: 121.3623,
      type: "zoo",
      city: "上海",
      country: "中国",
      day: 3,
    },
    {
      name: "滴水湖",
      lat: 30.9063,
      lon: 121.9376,
      type: "lake",
      city: "上海",
      country: "中国",
      day: 4,
    },
  ];

  for (const p of places) {
    current = addStop(current.id, dayIds[p.day - 1], {
      name: p.name,
      city: p.city,
      country: p.country,
      latitude: p.lat,
      longitude: p.lon,
      type: p.type,
    });
  }

  return true;
}
