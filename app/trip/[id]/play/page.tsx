"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
  const [mapFailed, setMapFailed] = useState(false);
  const [shot, setShot] = useState<PlaybackShot | null>(null);
  const [ended, setEnded] = useState(false);
  const [prewarming, setPrewarming] = useState(false);

  const startPlayback = () => {
    const engine = engineRef.current;
    if (!engine || !trip) return;
    ctrlRef.current?.cancel();
    setEnded(false);
    setShot(null);
    const ctrl = playTrip({
      engine,
      stops: trip.stops,
      segments: trip.segments,
      callbacks: {
        onShot: (s) => setShot(s),
        onEnd: (cancelled) => {
          if (!cancelled) setEnded(true);
        },
      },
    });
    ctrlRef.current = ctrl;
  };

  // 引擎就绪 → 先沿时间轴预飞一遍（瓦片/字形进缓存，同录制页的预热）→ 正式播放。
  // 预热后同会话重放基本全命中缓存；预热是最佳努力，失败照常播放。
  useEffect(() => {
    if (!trip || trip.stops.length < 2 || !engineReady || !engineRef.current) return;
    const engine = engineRef.current;
    let disposed = false;
    (async () => {
      setPrewarming(true);
      try {
        const tl = await buildTimeline({
          engine,
          stops: trip.stops,
          segments: trip.segments,
          stopDwellMs: () => 2000,
        });
        const map = engine.map;
        const syncRender =
          typeof map._render === "function"
            ? (t: number) => {
                map._render(t);
              }
            : null;
        await prewarmTimeline(map, engine, tl, syncRender, () => disposed);
      } catch {
        /* 预热失败不阻塞播放 */
      }
      if (disposed) return;
      setPrewarming(false);
      startPlayback();
    })();
    return () => {
      disposed = true;
      ctrlRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, engineReady]);

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
        activeDay={shot && shot.type !== "intro" ? (shot.day ?? null) : null}
        selectedStopId={shot?.stop?.id ?? null}
        onReady={(e) => {
          engineRef.current = e;
          setEngineReady(true);
        }}
        onFail={() => setMapFailed(true)}
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

      {/* 结束画面 */}
      {ended && (
        <div className="play-end fade-up">
          <p className="font-mono kicker">END OF STORY</p>
          <h2 className="font-display">{trip.name}</h2>
          <div className="play-end-actions">
            <button className="btn" onClick={startPlayback}>
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
