"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAgentView } from "@/lib/useAgentView";
import { useTrip } from "@/lib/useStore";
import { TravelMap } from "@/components/TravelMap";
import { playTrip, buildTimeline, type PlaybackShot } from "@/lib/map/playback";
import type { PlaybackController } from "@/lib/map/playback";
import { prewarmTimeline } from "@/lib/record/prewarm";
import { formatDistance } from "@/lib/routing";
import { TRANSPORT_META } from "@/lib/types";
import type { TripDay } from "@/lib/types";
import { formatDateCN } from "@/lib/store";
import { TransportGlyph } from "@/lib/icons";
import type { TravelMapEngine } from "@/lib/map/engine";

export default function PlayPage() {
  const params = useParams<{ id: string }>();
  const trip = useTrip(params.id);
  const router = useRouter();
  const engineRef = useRef<TravelMapEngine | null>(null);
  const ctrlRef = useRef<PlaybackController | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [shot, setShot] = useState<PlaybackShot | null>(null);
  const [ended, setEnded] = useState(false);
  const [prewarming, setPrewarming] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const currentTrip = useRef(trip); currentTrip.current = trip;
  const revisionRef = useRef<number | undefined>(undefined);
  const playbackGeneration = useRef(0);
  const allowAutoplay = useRef(true);
  const deepLinkConsumed = useRef<string | null>(null);
  const stopPlayback = () => {
    playbackGeneration.current++;
    const previous = ctrlRef.current;
    previous?.cancel();
    // Keep the old controller until its asynchronous cleanup has finished.
    setPlaying(false); setEnded(false); setShot(null);
    return previous?.done ?? Promise.resolve();
  };

  const startPlayback = async (afterPreparation = false) => {
    const engine = engineRef.current;
    const snapshot = currentTrip.current;
    if (!engine || !snapshot || (!afterPreparation && (!prepared || prewarming)) || snapshot.stops.length < 2) return;
    const generation = ++playbackGeneration.current;
    const previous = ctrlRef.current;
    previous?.cancel();
    await previous?.done;
    if (generation !== playbackGeneration.current || engine !== engineRef.current || snapshot.revision !== currentTrip.current?.revision) return;
    setNotice(''); setPlaying(true); setSelectedStop(null); setSelectedDay(null);
    setEnded(false); setShot(null);
    ctrlRef.current = playTrip({engine, stops:snapshot.stops, segments:snapshot.segments,
      callbacks:{
        onShot: s => {if(generation===playbackGeneration.current)setShot(s);},
        onEnd: cancelled => {
          if(generation!==playbackGeneration.current)return;
          setPlaying(false); if(!cancelled)setEnded(true);
        },
      },
    });
  };

  useEffect(() => {
    if (!trip || !engineReady || !engineRef.current) return;
    const engine = engineRef.current;
    let disposed = false;
    const initialTrip = trip;
    const generation = playbackGeneration.current;
    allowAutoplay.current = new URLSearchParams(window.location.search).get('autoplay') !== '0';
    setPrepared(false);
    setPrewarming(true);
    (async () => {
      try {
        if (initialTrip.stops.length >= 2) {
          const timeline = await buildTimeline({engine, stops:initialTrip.stops, segments:initialTrip.segments, stopDwellMs:()=>2000});
          const map = engine.map;
          const syncRender = typeof map._render === 'function' ? (t:number) => {map._render(t);} : null;
          await prewarmTimeline(map, engine, timeline, syncRender, () => disposed || playbackGeneration.current !== generation);
        }
      } catch { /* A failed warmup does not prevent interactive use. */ }
      if (disposed) return;
      setPrewarming(false); setPrepared(true);
      // Do not autoplay a changed revision or a cancelled warmup.
      if (allowAutoplay.current && currentTrip.current?.revision === initialTrip.revision && generation === playbackGeneration.current && initialTrip.stops.length >= 2) {
        await startPlayback(true);
      }
    })();
    return () => { disposed = true; void stopPlayback(); };
    // Preparation is once per map/trip; route refreshes must not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, engineReady]);

  useEffect(() => {
    if (!trip) return;
    if (revisionRef.current !== undefined && revisionRef.current !== trip.revision) {
      stopPlayback();
      setNotice('行程已更新，播放已停止。请重新播放。');
    }
    revisionRef.current = trip.revision;
  }, [trip?.revision]);

  const display = async (action: string, args: Record<string, unknown>) => {
    const engine = engineRef.current;
    if (!trip || !engineReady || !prepared || prewarming || !engine) throw new Error('地图尚未就绪');
    if (action === 'play' || action === 'restart') {
      if (trip.stops.length < 2) throw new Error('至少需要两个地点才能播放');
      await startPlayback(); return;
    }
    await stopPlayback();
    if (action === 'stop') { engine.fitToStops(trip.stops,100); return; }
    if (action === 'focus_stop') {
      const stop = trip.stops.find(s=>s.id===args.stopId);
      if (!stop) throw new Error('地点不存在');
      setSelectedStop(stop.id);setSelectedDay(stop.day);engine.flyToStop(stop);
    } else if (action === 'show_day') {
      const day = trip.days.find(d=>d.id===args.dayId);
      if (!day) throw new Error('日期不存在');
      setSelectedStop(null);setSelectedDay(day.day);
      engine.fitToStops(trip.stops.filter(s=>s.dayId===day.id),100);
    } else if (action === 'fit_trip') {
      setSelectedStop(null);setSelectedDay(null);engine.fitToStops(trip.stops,100);
    } else throw new Error('不支持的地图操作');
    if (engine.map.isMoving()) await new Promise<void>((resolve,reject)=>{
      const finish=()=>{clearTimeout(timer);engine.map.off('moveend',finish);resolve();};
      const timer=setTimeout(()=>{engine.map.off('moveend',finish);reject(new Error('地图移动超时'));},5000);
      engine.map.once('moveend',finish);
    });
  };
  useAgentView({tripId:params.id,page:'play',ready:!!trip && engineReady && prepared && !prewarming,
    getMapState: () => {
      const map = engineRef.current?.map;
      const status = mapError ? 'failed' : engineReady ? 'ready' : 'loading';
      if (!map) return {status,...(mapError ? {error:mapError} : {})};
      const center = map.getCenter();
      return {status,...(mapError ? {error:mapError} : {}),center:{lng:center.lng,lat:center.lat},zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()};
    },
    selection:{stopId:selectedStop ?? shot?.stop?.id ?? null,day:selectedDay ?? shot?.day ?? null,dayId:trip?.days.find(day=>day.day===(selectedDay ?? shot?.day))?.id ?? null},
    playback:{playing,ended,prewarming},onCommand:command=>display(command.action,command.args)});
  useEffect(()=>{
    if (!trip || !prepared || prewarming || deepLinkConsumed.current===trip.id) return;
    deepLinkConsumed.current=trip.id;
    const query=new URLSearchParams(window.location.search);
    const stopId=query.get('stopId'),dayId=query.get('dayId');
    if(stopId)void display('focus_stop',{stopId}).catch(()=>{});
    else if(dayId)void display('show_day',{dayId}).catch(()=>{});
  },[trip,prepared,prewarming]);

  if (!trip) {
    return (
      <div className="play-empty">
        <p>行程不存在。</p>
        <Link href="/" className="btn">
          返回首页
        </Link>
      </div>
    );
  }

  const total = trip.stops.length;
  const progress = shot
    ? shot.type === "intro"
      ? 0
      : Math.min(100, Math.round((shot.index / total) * 100))
    : 0;

  function exit() {
    ctrlRef.current?.cancel();
    router.push(`/trip/${trip!.id}`);
  }

  return (
    <main className="play">
      <TravelMap
        trip={trip}
        // 非当天的地点淡化、当前点置顶，观众一眼认出当天路线
        activeDay={selectedDay ?? (shot && shot.type !== "intro" ? (shot.day ?? null) : null)}
        selectedStopId={selectedStop ?? shot?.stop?.id ?? null}
        onReady={(e) => {
          engineRef.current = e;
          setMapFailed(false);
          setMapError(null);
          setEngineReady(true);
        }}
        onFail={(message) => { setMapError(message); setMapFailed(true); setEngineReady(false); void stopPlayback(); }}
      />

      {/* 影院暗色遮罩：让地图与场记卡有层次 */}
      <div className="play-vignette" />

      {/* 顶部栏 */}
      <header className="play-top">
        <button className="play-exit font-mono" onClick={exit}>
          ✕ 退出
        </button>
        <div className="play-progress">
          <div className="play-progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <span className="font-mono play-counter">
          {shot?.type === "stop" ? String(shot.index).padStart(2, "0") : "00"} /{" "}
          {String(total).padStart(2, "0")}
        </span>
      </header>

      {/* 播前预热：预热时镜头沿全程预飞，蒙板压住别吓到用户 */}
      {prewarming && !mapFailed && (
        <div className="play-prewarm">
          <span className="rec-spin" aria-hidden />
          <p className="font-mono kicker">PREWARM</p>
          <h2 className="font-display">正在预热地图瓦片</h2>
          <p>
            首次播放前先沿全程预飞一遍，把沿途瓦片装进缓存——只此一遍，
            之后播放就丝滑了。路程越远这一步越久，请稍候。
          </p>
        </div>
      )}

      {/* 场记卡 */}
      {mapFailed ? (
        <div className="slate" key="map-fail">
          <div className="kicker">MAP OFFLINE</div>
          <h1 className="title" style={{ fontSize: 28 }}>
            地图未初始化
          </h1>
          <div className="sub">本机环境无法运行地图（WebGL 受限），暂无法播放。</div>
        </div>
      ) : !engineReady ? (
        <div className="slate" key="loading">
          <div className="kicker">PREPARING</div>
          <h1 className="title" style={{ fontSize: 28 }}>
            正在加载地图…
          </h1>
        </div>
      ) : (
        <Slate shot={shot} tripName={trip.name} region={trip.region ?? ""} days={trip.days} />
      )}

      {notice && <div role="status" style={{position:'absolute',bottom:24,left:24,zIndex:20,padding:16,background:'#fff8eb',color:'#322d27'}}>
        {notice} <button className="btn btn-sm" onClick={() => {void startPlayback();}} disabled={!prepared || prewarming || trip.stops.length<2}>重新播放</button>
      </div>}
      {/* 结束画面 */}
      {ended && (
        <div className="play-end fade-up">
          <p className="font-mono kicker">END OF STORY</p>
          <h2 className="font-display">{trip.name}</h2>
          <div className="play-end-actions">
            <button className="btn" onClick={() => {void startPlayback();}}>
              ↻ 重新播放
            </button>
            <button className="btn btn-ghost" onClick={exit}>
              返回规划
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Slate({
  shot,
  tripName,
  region,
  days,
}: {
  shot: PlaybackShot | null;
  tripName: string;
  region: string;
  days?: TripDay[];
}) {
  if (!shot) return null;

  if (shot.type === "intro") {
    return (
      <div className="slate" key="intro">
        <div className="kicker">A TRAVEL STORY</div>
        <h1 className="title">{tripName}</h1>
        <div className="sub">{region.toUpperCase() || "YOUR JOURNEY"}</div>
      </div>
    );
  }

  // 章节卡：每一天都是新的一天——暗色蒙板压全场，DAY 居中
  if (shot.type === "day") {
    const d = days?.find((x) => x.day === shot.day);
    return (
      <div className="day-mask" key={`day-${shot.day}`}>
        <div className="day-mask-inner">
          <div className="kicker">{d?.date ? formatDateCN(d.date) : tripName}</div>
          <h1 className="day-mask-title">DAY {String(shot.day ?? 1).padStart(2, "0")}</h1>
        </div>
      </div>
    );
  }

  if (shot.type === "stop" && shot.stop) {
    return (
      <div className="slate" key={`stop-${shot.stop.id}`}>
        <div className="kicker">
          DAY {String(shot.day ?? 0).padStart(2, "0")} ·{" "}
          {(shot.stop.city || region || "").toUpperCase()}
        </div>
        <h1 className="title">{shot.stop.name}</h1>
      </div>
    );
  }

  if (shot.type === "segment" && shot.segment) {
    const meta = TRANSPORT_META[shot.segment.transport];
    const from = shot.stop?.name ?? "";
    const to = shot.nextStop?.name ?? "NEXT STOP";
    const long = (from + to).length;
    const dist = shot.segment.distance;
    return (
      <div className="slate" key={`seg-${shot.segment.id}`}>
        <div className="kicker">
          NEXT STOP · {meta.label}
          {dist != null && dist > 0 ? ` · ${formatDistance(dist)}` : ""}
        </div>
        <h1
          className="title seg-route"
          style={{ fontSize: long > 18 ? 28 : long > 12 ? 40 : 56 }}
        >
          <span>{from}</span>
          <span className="seg-arrow">
            <i className="seg-arrow-line" />
            <span className="seg-arrow-icon">
              <TransportGlyph
                transport={shot.segment.transport}
                size={48}
                weight="fill"
                color="#F6F1E4"
              />
            </span>
            <i className="seg-arrow-line" />
            <i className="seg-arrow-head" />
          </span>
          <span>{to}</span>
        </h1>
      </div>
    );
  }

  return null;
}
