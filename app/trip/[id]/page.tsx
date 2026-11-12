"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTrip } from "@/lib/useStore";
import {
  getTrip,
  addDay,
  addStop,
  addStopMedia,
  removeDay,
  removeStop,
  removeStopMedia,
  moveStop,
  setStopTransport,
} from "@/lib/store";
import { deleteMediaBlob, putMediaBlob } from "@/lib/media";
import type { SearchResult, Transport } from "@/lib/types";
import { useAgentView } from "@/lib/useAgentView";
import { resolvePresentationTarget } from "@/lib/agentPresentation";
import { TravelMap } from "@/components/TravelMap";
import { PlanTimeline } from "@/components/PlanTimeline";
import type { TravelMapEngine } from "@/lib/map/engine";

export default function TripPage() {
  const params = useParams<{ id: string }>();
  const trip = useTrip(params.id);
  const router = useRouter();
  const engineRef = useRef<TravelMapEngine | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [agentNotice, setAgentNotice] = useState<{message:string;status:'running'|'completed'|'failed'} | null>(null);
  const [agentStopIds, setAgentStopIds] = useState<string[]>([]);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(()=>()=>{if(noticeTimer.current)clearTimeout(noticeTimer.current);},[]);
  const fetchingRef = useRef(false);
  const [routePass, setRoutePass] = useState(0);
  const attemptedRoutes = useRef(new Set<string>());
  const conflictedRouteRevisions = useRef(new Map<string, number | undefined>());
  const deepLinkConsumed = useRef<string | null>(null);
  const safe = (operation: Promise<unknown>) => { void operation.catch(() => {}); };

  const display = async (action: string, args: Record<string, unknown>) => {
    const engine = engineRef.current;
    const snapshot = getTrip(params.id);
    if (!snapshot || !engine || !engineReady) throw new Error("地图尚未就绪");
    const presenting = action === 'present_change';
    try {
    if (presenting) {
      if ((snapshot.revision ?? -1) < Number(args.revision)) throw new Error('行程尚未同步');
      if(noticeTimer.current)clearTimeout(noticeTimer.current);
      const message = typeof args.message === 'string' ? args.message : 'Agent 已更新行程';
      setAgentNotice({message,status:'running'});
      const addedIds = Array.isArray(args.addedStopIds) ? args.addedStopIds.filter((id): id is string=>typeof id==='string') : [];
      const target = resolvePresentationTarget(args,snapshot);
      const stop = snapshot.stops.find(s=>s.id===target.stopId);
      const day = snapshot.days.find(d=>d.id===target.dayId);
      setAgentStopIds([...new Set([...addedIds,...(stop ? [stop.id] : [])])]);
      if (stop) {
        setSelectedStopId(stop.id);setActiveDay(stop.day);engine.flyToStop(stop);
        const card = [...document.querySelectorAll<HTMLElement>('[data-stop-id]')].find(element=>element.dataset.stopId===stop.id);
        card?.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      } else if(day) {
        setSelectedStopId(null);setActiveDay(day.day);
        engine.fitToStops(snapshot.stops.filter(s=>s.dayId===day.id),100);
        [...document.querySelectorAll<HTMLElement>('[data-day-id]')].find(element=>element.dataset.dayId===day.id)?.scrollIntoView({block:'nearest'});
      } else if(args.fitTrip === true) {
        setSelectedStopId(null);setActiveDay(null);engine.fitToStops(snapshot.stops,100);
      }
    } else if (action === 'focus_stop') {
      const stop = snapshot.stops.find(s => s.id === args.stopId);
      if (!stop) throw new Error("地点不存在");
      setSelectedStopId(stop.id); setActiveDay(stop.day); engine.flyToStop(stop);
    } else if (action === 'show_day') {
      const day = snapshot.days.find(d => d.id === args.dayId);
      if (!day) throw new Error("日期不存在");
      setSelectedStopId(null); setActiveDay(day.day);
      const stops = snapshot.stops.filter(s => s.dayId === day.id);
      if (stops.length) engine.fitToStops(stops, 100);
    } else if (action === 'fit_trip') {
      setSelectedStopId(null); setActiveDay(null);
      if (snapshot.stops.length) engine.fitToStops(snapshot.stops, 100);
    } else throw new Error("规划页面不支持该操作");
    if (engine.map.isMoving()) await new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timer); engine.map.off('moveend', finish); resolve(); };
      const timer = setTimeout(() => { engine.map.off('moveend', finish); reject(new Error('地图移动超时')); }, 5000);
      engine.map.once('moveend', finish);
    });
    if (presenting) {
      setAgentNotice(previous=>previous ? {...previous,status:'completed'} : null);
      noticeTimer.current=setTimeout(()=>{setAgentNotice(null);setAgentStopIds([]);},7000);
    }
    } catch(error) {
      if(presenting)setAgentNotice(previous=>previous ? {...previous,status:'failed'} : null);
      throw error;
    }
  };
  const agentView = useAgentView({tripId: params.id, page: 'plan', ready: !!trip && engineReady,
    getMapState: () => {
      const map = engineRef.current?.map;
      const status = mapError ? 'failed' : engineReady ? 'ready' : 'loading';
      if (!map) return {status,...(mapError ? {error:mapError} : {})};
      const center = map.getCenter();
      return {status,...(mapError ? {error:mapError} : {}),center:{lng:center.lng,lat:center.lat},zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()};
    },
    selection: { stopId: selectedStopId, day: activeDay, dayId: trip?.days.find(day => day.day === activeDay)?.id ?? null }, onCommand: command => display(command.action, command.args)});
  useEffect(() => {
    if (!trip || !engineReady || deepLinkConsumed.current === trip.id) return;
    deepLinkConsumed.current = trip.id;
    const query = new URLSearchParams(window.location.search);
    const stopId = query.get('stopId'), dayId = query.get('dayId');
    if (stopId) safe(display('focus_stop', {stopId}));
    else if (dayId) safe(display('show_day', {dayId}));
  }, [trip, engineReady]);

  // Route calculations use the same server service as MCP; unavailable routes are not retried in a loop.
  useEffect(() => {
    if (!trip || trip.agentTaskActive || fetchingRef.current) return;
    const pending = trip.segments.filter(seg => !seg.route && !seg.routeInfo);
    const key = JSON.stringify([trip.id, pending.map(seg => [seg.id, seg.fromStopId, seg.toStopId, seg.transport,
      ...[seg.fromStopId,seg.toStopId].map(id => {const stop=trip.stops.find(s=>s.id===id);return stop ? [stop.longitude,stop.latitude] : null;})])]);
    if (!pending.length || attemptedRoutes.current.has(key)) return;
    if (conflictedRouteRevisions.current.has(key) && conflictedRouteRevisions.current.get(key) === trip.revision) return;
    conflictedRouteRevisions.current.delete(key);
    attemptedRoutes.current.add(key);
    fetchingRef.current = true;
    fetch('/api/routes', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
      tripId: trip.id, expectedRevision: trip.revision, requestId: crypto.randomUUID(), segmentIds: pending.map(s => s.id),
    })}).then(async response => {
      if (!response.ok) {
        const body = await response.json();
        if (body.error?.code === 'PLAN_TASK_ACTIVE') { attemptedRoutes.current.delete(key); return; }
        if (body.error?.code === 'REVISION_CONFLICT') {
          attemptedRoutes.current.delete(key);
          conflictedRouteRevisions.current.set(key, trip.revision);
        }
        console.warn('[travel-story] 路线计算失败', body.error);
      }
    }).catch(error => console.warn('[travel-story] 路线计算失败', error))
      .finally(() => { fetchingRef.current = false; setRoutePass(n=>n+1); });
  }, [trip, routePass]);

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
    setActiveDay(null);
    const stop = trip!.stops.find((s) => s.id === stopId);
    if (stop) engineRef.current?.flyToStop(stop);
  }

  function handleAddStop(dayId: string, r: SearchResult) {
    safe(addStop(trip!.id, dayId, {
      name: r.name,
      city: r.city,
      country: r.country,
      latitude: r.latitude,
      longitude: r.longitude,
      type: r.type,
    }));
  }

  function handleSetTransport(fromStopId: string, t: Transport) {
    safe(setStopTransport(trip!.id, fromStopId, t));
  }

  function handleMoveStop(stopId: string, targetDayId: string, targetIndex: number) {
    safe(moveStop(trip!.id, stopId, targetDayId, targetIndex));
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
      try { await addStopMedia(trip.id, stopId, {
        id,
        kind: f.type.startsWith("video") ? "video" : "image",
        name: f.name,
        createdAt: Date.now(),
      }); } catch { /* Shared sync status reports the failed metadata save. */ }
    }
  }

  async function handleRemoveMedia(stopId: string, mediaId: string) {
    if (!trip) return;
    try { await removeStopMedia(trip.id, stopId, mediaId); } catch { return; }
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

      {(agentNotice || agentView.error) && <aside className="agent-activity" role="status" aria-live="polite">
        <span className="font-mono">{agentNotice?.status==='running'?'正在展示':agentNotice?.status==='completed'?'已完成':agentNotice?.status==='failed'?'展示未完成':'连接提示'}</span>
        <span>{agentNotice?.message ?? agentView.error}</span>
        {agentView.error && agentNotice && <small>{agentView.error}</small>}
      </aside>}
      <div className="plan-body">
        <aside className="plan-sidebar">
          <PlanTimeline
            trip={trip}
            selectedStopId={selectedStopId}
            agentStopIds={agentStopIds}
            onSelectStop={(s) => handleSelectStop(s.id)}
            onAddStop={handleAddStop}
            onRemoveStop={(id) => safe(removeStop(trip.id, id))}
            onMoveStop={handleMoveStop}
            onSetTransport={handleSetTransport}
            onAddDay={() => safe(addDay(trip.id))}
            onRemoveDay={(dayId) => safe(removeDay(trip.id, dayId))}
            onHoverSearch={handleHoverSearch}
            onAddMedia={handleAddMedia}
            onRemoveMedia={handleRemoveMedia}
          />
        </aside>

        <section className="plan-map">
          <TravelMap
            trip={trip}
            selectedStopId={selectedStopId}
            activeDay={activeDay}
            onReady={(engine) => { engineRef.current = engine; setMapError(null); setEngineReady(true); }}
            onFail={(message) => { setMapError(message); setEngineReady(false); }}
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
