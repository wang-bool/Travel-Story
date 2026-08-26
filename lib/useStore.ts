"use client";

// React 订阅 store：useSyncExternalStore，任意组件拿到 trips 快照
// 并在 store 变更时重渲染。

import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe } from "./store";
import type { Trip } from "./types";

// 第三参 serverSnapshot：SSR 与水合期固定返回空数组，与服务端 HTML 一致，
// 避免 hydration mismatch（localStorage 只在客户端存在）。水合完成后
// React 会自动切换到真实 getSnapshot，并订阅 store 变更。
const EMPTY: Trip[] = [];

export function useTrips(): Trip[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

export function useTrip(id: string | null | undefined): Trip | null {
  const trips = useTrips();
  return id ? trips.find((t) => t.id === id) ?? null : null;
}
