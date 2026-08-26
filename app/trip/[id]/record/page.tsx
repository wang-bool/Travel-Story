"use client";

// ============================================================
// Travel Story — 纪录片录制页（/trip/[id]/record）
//
// 实时录制：先沿时间轴预热一遍（瓦片/字形进缓存），再实时播放
// 行程，合成器逐帧画到输出画布（画幅 横屏/竖屏、清晰度 1080P/720P、
// 帧率 60/30 可选），MediaRecorder 录画布流，服务端转成 MP4。
// 耗时 ≈ 预热 + 成片时长。演示什么样，成片就什么样。
//
// 竖屏模式把地图容器收成 9:16：cameraForBounds 按容器取景，
// 取景范围与输出画幅一致，且地图源分辨率全程用满，不靠裁切。
// ============================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTrip } from "@/lib/useStore";
import { TravelMap } from "@/components/TravelMap";
import {
  createCompositor,
  videoSpec,
  mapPixelRatioFor,
  VIDEO_FORMATS,
  type Compositor,
  type VideoFormat,
  type VideoQuality,
  type VideoFps,
} from "@/lib/record/compositor";
import {
  recordRealtime,
  type RealtimeRecorder,
  type RecordPhase,
  type RecordResult,
} from "@/lib/record/realtime";
import type { TravelMapEngine } from "@/lib/map/engine";

type Phase = "preparing" | "ready" | "rendering" | "done" | "error";

const PHASE_LABEL: Record<RecordPhase, string> = {
  prewarm: "预热瓦片中",
  record: "录制中",
  encode: "转码合成中",
};

/** 预热 / 转码阶段的居中醒目提示：这两步没有画面进展，用户对着黑监视器
 *  容易以为卡死——大字告诉ta进行到哪、在干什么、还要等多久。
 *  录制阶段不弹（监视器画面本身就是进展）。 */
const PHASE_NOTICE: Record<
  "prewarm" | "encode",
  { kicker: string; title: string; info: string }
> = {
  prewarm: {
    kicker: "STEP 1 / 3 · PREWARM",
    title: "正在预热地图瓦片",
    info: "开录前先沿全程预飞一遍，把沿途的瓦片和地名装进缓存——只此一遍，正式录制才不会半路等元素。路程越远这一步越久，请稍候，无需刷新页面。",
  },
  encode: {
    kicker: "STEP 3 / 3 · ENCODE",
    title: "正在转码合成 MP4",
    info: "画面已全部录完，正在上传并转码合成 MP4。视频较长时可能需要一两分钟，请稍候，不要关闭页面。",
  },
};

export default function RecordPage() {
  const params = useParams<{ id: string }>();
  const trip = useTrip(params.id);
  const router = useRouter();
  const engineRef = useRef<TravelMapEngine | null>(null);
  const compRef = useRef<Compositor | null>(null);
  const recorderRef = useRef<RealtimeRecorder | null>(null);

  const [engineReady, setEngineReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("preparing");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [recordPhase, setRecordPhase] = useState<RecordPhase>("prewarm");
  const [result, setResult] = useState<RecordResult | null>(null);
  /** 输出画幅：横屏 16:9 / 竖屏 9:16 */
  const [format, setFormat] = useState<VideoFormat>("landscape");
  /** 清晰度：720P 地图渲染像素更少，出片快约一倍 */
  const [quality, setQuality] = useState<VideoQuality>("1080");
  /** 流畅度：30fps 帧数减半，出片快一倍 */
  const [fps, setFps] = useState<VideoFps>(60);
  /** 渲染监视器：输出画布挂进 DOM，每一帧所见即所得 */
  const monitorRef = useRef<HTMLDivElement>(null);

  const totalStops = trip?.stops.length ?? 0;
  const mediaCount =
    trip?.stops.reduce((a, s) => a + (s.media?.length ?? 0), 0) ?? 0;

  // 引擎就绪 → 建合成器（实时录制模式）、预载素材；切规格时重建（输出画布尺寸/帧率随规格变）
  useEffect(() => {
    if (!engineReady || !engineRef.current || !trip) return;
    setPhase("preparing");
    const comp = createCompositor({
      engine: engineRef.current,
      trip,
      offline: false,
      format,
      quality,
      fps,
    });
    compRef.current = comp;
    let stale = false; // 切规格重建时，旧合成器的 ready 不得把状态抢回 ready
    comp.ready
      .then(() => {
        if (!stale) setPhase((p) => (p === "preparing" ? "ready" : p));
      })
      .catch((e) => {
        if (stale) return;
        console.error("[travel-story] 素材预载失败", e);
        setError("素材预载失败");
        setPhase("error");
      });
    return () => {
      stale = true;
      comp.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, trip?.id, format, quality, fps]);

  // 地图源分辨率要盖过输出才不发虚；清晰度低时降下来，每帧地图渲染更省
  useEffect(() => {
    if (!engineReady || !engineRef.current) return;
    engineRef.current.map.setPixelRatio(mapPixelRatioFor(format, quality));
  }, [engineReady, format, quality]);

  // 离开页面兜底：取消录制
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      compRef.current?.stop();
    };
  }, []);

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

  if (trip.stops.length < 2) {
    return (
      <div className="play-empty">
        <p>至少两个地点才能生成纪录片。</p>
        <Link href={`/trip/${trip.id}`} className="btn">
          返回规划
        </Link>
      </div>
    );
  }

  function startRender() {
    const engine = engineRef.current;
    const comp = compRef.current;
    if (!engine || !comp || phase === "rendering") return;

    // 输出画布挂上监视器，录制全程所见即所得
    if (monitorRef.current && !monitorRef.current.contains(comp.canvas)) {
      monitorRef.current.appendChild(comp.canvas);
    }
    setPhase("rendering");
    setElapsedMs(0);
    setRecordPhase("prewarm");

    const recorder = recordRealtime({
      engine,
      trip: trip!,
      compositor: comp,
      fps,
      onProgress: (elapsed, total, p) => {
        setElapsedMs(elapsed);
        setTotalMs(total);
        setRecordPhase(p);
      },
    });
    recorderRef.current = recorder;
    recorder.done
      .then((res) => {
        if (!res) return; // 用户取消（cancelRender 负责跳转）
        setResult(res);
        setPhase("done");
      })
      .catch((e) => {
        console.error("[travel-story] 纪录片录制失败", e);
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
  }

  function cancelRender() {
    recorderRef.current?.cancel();
    router.push(`/trip/${trip!.id}`);
  }

  const progress =
    totalMs > 0 ? Math.min(100, Math.round((elapsedMs / totalMs) * 100)) : 0;
  const spec = videoSpec(format, quality);

  return (
    <main className={`play${format === "portrait" ? " rec-portrait" : ""}`}>
      <TravelMap
        trip={trip}
        // 实时录制走 captureStream 抓地图画布（GPU 侧拷贝）；保留绘制缓冲兜底老内核直读
        preserveDrawingBuffer
        pixelRatio={1.5}
        hideMarkers
        onReady={(e) => {
          engineRef.current = e;
          setEngineReady(true);
        }}
        onFail={(msg) => {
          setError(`地图初始化失败：${msg}`);
          setPhase("error");
        }}
      />
      <div className="play-vignette" />

      {/* 渲染监视器：录制时输出画布上屏，所见即所得 */}
      <div
        ref={monitorRef}
        className={`rec-monitor${phase === "rendering" ? " on" : ""}`}
      />

      {/* 预热 / 转码：居中醒目提示（这两步监视器没有画面进展）。
          key 随阶段切换重挂载，淡入动画重播一次 */}
      {phase === "rendering" && recordPhase !== "record" && (
        <div className="rec-card rec-notice fade-up" key={recordPhase}>
          <span className="rec-spin" aria-hidden />
          <p className="font-mono kicker">{PHASE_NOTICE[recordPhase].kicker}</p>
          <h2 className="font-display">{PHASE_NOTICE[recordPhase].title}</h2>
          <p className="rec-card-info">{PHASE_NOTICE[recordPhase].info}</p>
        </div>
      )}

      {/* 顶部：渲染状态栏（只在画布外的 DOM，不会进视频） */}
      <header className="play-top">
        <button className="play-exit font-mono" onClick={cancelRender}>
          ✕ {phase === "rendering" ? "取消录制" : "返回"}
        </button>
        <div className="play-progress">
          <div className="play-progress-bar" style={{ width: `${progress}%` }} />
        </div>
        {phase === "rendering" && (
          <span className="rec-badge font-mono">
            <span className="rec-dot" />
            {PHASE_LABEL[recordPhase]}
            {recordPhase === "record" && totalMs > 0 && (
              <>
                {" "}
                {Math.floor(elapsedMs / 1000)}″ / {Math.round(totalMs / 1000)}″
              </>
            )}
          </span>
        )}
      </header>

      {/* 开始渲染卡片 */}
      {phase === "ready" && (
        <div className="rec-card fade-up">
          <p className="font-mono kicker">GENERATE DOCUMENTARY</p>
          <h2 className="font-display">生成纪录片</h2>
          <p className="rec-card-info">
            {totalStops} 个地点 · {mediaCount} 份素材 · 输出 {spec.w}×{spec.h} {fps}fps
            {format === "portrait" ? " 竖屏" : " 横屏"} MP4
            <br />
            实时录制：先预热瓦片，再完整播放一遍并录下画面，耗时≈成片时长。
            机器较老可选 720P + 30fps，更不容易录进卡顿。
          </p>
          <div className="rec-opt" role="group" aria-label="视频画幅">
            <span className="rec-opt-label font-mono">画幅</span>
            <div className="rec-formats">
              {(Object.keys(VIDEO_FORMATS) as VideoFormat[]).map((f) => (
                <button
                  key={f}
                  className={f === format ? "on" : ""}
                  onClick={() => setFormat(f)}
                >
                  {VIDEO_FORMATS[f].label}
                  <span className="rec-format-sub font-mono">
                    {VIDEO_FORMATS[f].hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="rec-opt" role="group" aria-label="清晰度">
            <span className="rec-opt-label font-mono">清晰度</span>
            <div className="rec-formats">
              {(["1080", "720"] as VideoQuality[]).map((q) => (
                <button
                  key={q}
                  className={q === quality ? "on" : ""}
                  onClick={() => setQuality(q)}
                >
                  {q}P
                  <span className="rec-format-sub font-mono">
                    {videoSpec(format, q).w}×{videoSpec(format, q).h}
                    {q === "720" ? " · 更稳" : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="rec-opt" role="group" aria-label="流畅度">
            <span className="rec-opt-label font-mono">流畅度</span>
            <div className="rec-formats">
              {([60, 30] as VideoFps[]).map((v) => (
                <button
                  key={v}
                  className={v === fps ? "on" : ""}
                  onClick={() => setFps(v)}
                >
                  {v}fps
                  <span className="rec-format-sub font-mono">
                    {v === 60 ? "最丝滑" : "更稳不卡"}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <button className="btn" onClick={startRender}>
            ● 开始录制
          </button>
        </div>
      )}

      {phase === "preparing" && (
        <div className="rec-card">
          <p className="font-mono kicker">PREPARING</p>
          <h2 className="font-display">正在准备…</h2>
          <p className="rec-card-info">加载字体与素材中（共 {mediaCount} 份）。</p>
        </div>
      )}

      {phase === "done" && result && (
        <div className="rec-card fade-up">
          <p className="font-mono kicker">DONE</p>
          <h2 className="font-display">纪录片已生成</h2>
          <p className="rec-card-info">
            {result.file} · {(result.size / 1024 / 1024).toFixed(1)} MB
          </p>
          <div className="rec-card-actions">
            <a className="btn" href={`${result.url}?download=1`}>
              ⬇ 下载视频
            </a>
            <a className="btn btn-ghost" href={result.url} target="_blank" rel="noreferrer">
              在线播放
            </a>
            <button className="btn btn-ghost" onClick={() => router.push(`/trip/${trip.id}`)}>
              返回规划
            </button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="rec-card">
          <p className="font-mono kicker">ERROR</p>
          <h2 className="font-display">出错了</h2>
          <p className="rec-card-info">{error}</p>
          <div className="rec-card-actions">
            <button className="btn btn-ghost" onClick={() => router.push(`/trip/${trip.id}`)}>
              返回规划
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
