"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTrip } from "@/lib/useStore";
import {
  addDay,
  addStop,
  addStopMedia,
  removeDay,
  removeStop,
  removeStopMedia,
  moveStop,
  setStopTransport,
  setSegmentRoute,
} from "@/lib/store";
import { deleteMediaBlob, putMediaBlob } from "@/lib/media";
import type { SearchResult, Transport } from "@/lib/types";
import { routing } from "@/lib/routing";
import { TravelMap } from "@/components/TravelMap";
import { PlanTimeline } from "@/components/PlanTimeline";
import type { TravelMapEngine } from "@/lib/map/engine";

export default function TripPage() {
  const params = useParams<{ id: string }>();
  const trip = useTrip(params.id);
  const router = useRouter();
  const engineRef = useRef<TravelMapEngine | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const fetchingRef = useRef<Set<string>>(new Set());

  // 后台异步拉取缺失的路段真实路线（car/walk 走 OSRM，plane 走大圆航线）
  useEffect(() => {
    if (!trip) return;
    let cancelled = false;
    for (const seg of trip.segments) {
      if (seg.route || fetchingRef.current.has(seg.fromStopId)) continue;
      const from = trip.stops.find((s) => s.id === seg.fromStopId);
      const to = trip.stops.find((s) => s.id === seg.toStopId);
      if (!from || !to) continue;
      fetchingRef.current.add(seg.fromStopId);
      routing
        .getRoute([from.longitude, from.latitude], [to.longitude, to.latitude], seg.transport)
        .then((res) => {
          if (cancelled) return;
          // 只有权威路线（真实道路 / 飞机大圆 / 轮船直线）才持久化显示；
          // OSRM 失败时的兜底直线不存，避免在规划图上画出误导性直线。
          if (!res.authoritative) return;
          setSegmentRoute(trip.id, seg.fromStopId, {
            ...seg,
            route: res.route,
            distance: res.distance,
            duration: res.duration,
          });
        })
        .catch(() => {})
        .finally(() => fetchingRef.current.delete(seg.fromStopId));
    }
    return () => {
      cancelled = true;
    };
  }, [trip]);

  if (!trip) {
    return (
      <div className="notfound">
        <p>找不到这个行程。</p>
        <Link href="/" className="btn">
          返回首页
        </Link>
      </div>
    );
  }

  function handleSelectStop(stopId: string) {
    setSelectedStopId(stopId);
    const stop = trip!.stops.find((s) => s.id === stopId);
    if (stop) engineRef.current?.flyToStop(stop);
  }

  function handleAddStop(dayId: string, r: SearchResult) {
    addStop(trip!.id, dayId, {
      name: r.name,
      city: r.city,
      country: r.country,
      latitude: r.latitude,
      longitude: r.longitude,
      type: r.type,
    });
  }

  function handleSetTransport(fromStopId: string, t: Transport) {
    setStopTransport(trip!.id, fromStopId, t);
  }

  function handleMoveStop(stopId: string, targetDayId: string, targetIndex: number) {
    moveStop(trip!.id, stopId, targetDayId, targetIndex);
  }

  /** 素材上传：二进制进 IndexedDB，元数据（含 kind 判定）进行程 */
  async function handleAddMedia(stopId: string, files: File[]) {
    if (!trip) return;
    for (const f of files) {
      const id = `media_${crypto.randomUUID()}`;
      try {
        await putMediaBlob(id, f);
      } catch (e) {
        console.warn("[travel-story] 素材写入 IndexedDB 失败", e);
        continue;
      }
      addStopMedia(trip.id, stopId, {
        id,
        kind: f.type.startsWith("video") ? "video" : "image",
        name: f.name,
        createdAt: Date.now(),
      });
    }
  }

  function handleRemoveMedia(stopId: string, mediaId: string) {
    if (!trip) return;
    removeStopMedia(trip.id, stopId, mediaId);
    // 元数据删成功后删掉服务端二进制
    deleteMediaBlob(mediaId).catch(() => {});
  }

  /** 搜索结果悬停预览：飞到该地点；离开时回到行程取景 */
  function handleHoverSearch(r: SearchResult | null) {
    const engine = engineRef.current;
    if (!engine) return;
    if (r) {
      engine.flyTo(
        { center: [r.longitude, r.latitude], zoom: 12.5, bearing: 0, pitch: 0 },
        700
      );
    } else if (trip) {
      engine.fitToStops(trip.stops, 100);
    }
  }

  return (
    <main className="plan">
      <header className="plan-topbar">
        <Link href="/" className="topbar-back font-mono">
          ← 所有旅行
        </Link>
        <div className="topbar-title">
          <span className="font-mono kicker">PLAN</span>
          <h1 className="font-display">{trip.name}</h1>
        </div>
        <div className="topbar-actions">
          <button
            className="btn btn-ghost btn-sm"
            disabled={trip.stops.length < 2}
            onClick={() => router.push(`/trip/${trip.id}/record`)}
            title={trip.stops.length < 2 ? "至少添加两个地点才能生成" : "把行程录制成纪录片视频"}
          >
            🎬 生成纪录片
          </button>
          <button
            className="btn topbar-play"
            disabled={trip.stops.length < 2}
            onClick={() => router.push(`/trip/${trip.id}/play`)}
            title={trip.stops.length < 2 ? "至少添加两个地点才能播放" : "播放行程预览"}
          >
            ▶ 播放行程
          </button>
        </div>
      </header>

      <div className="plan-body">
        <aside className="plan-sidebar">
          <PlanTimeline
            trip={trip}
            selectedStopId={selectedStopId}
            onSelectStop={(s) => handleSelectStop(s.id)}
            onAddStop={handleAddStop}
            onRemoveStop={(id) => removeStop(trip.id, id)}
            onMoveStop={handleMoveStop}
            onSetTransport={handleSetTransport}
            onAddDay={() => addDay(trip.id)}
            onRemoveDay={(dayId) => removeDay(trip.id, dayId)}
            onHoverSearch={handleHoverSearch}
            onAddMedia={handleAddMedia}
            onRemoveMedia={handleRemoveMedia}
          />
        </aside>

        <section className="plan-map">
          <TravelMap
            trip={trip}
            selectedStopId={selectedStopId}
            onReady={(engine) => (engineRef.current = engine)}
            onStopClick={(s) => handleSelectStop(s.id)}
          />
          <div className="map-legend font-mono">
            <span className="dot dot-traveled" /> 已规划路线
          </div>
        </section>
      </div>
    </main>
  );
}
