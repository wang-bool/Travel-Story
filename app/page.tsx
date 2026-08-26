"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTrips } from "@/lib/useStore";
import { deleteTrip, formatDateCN, tripDays, updateTrip, whenSynced } from "@/lib/store";
import { seedIfEmpty } from "@/lib/seed";
import { CreateTripModal } from "@/components/CreateTripModal";
import { LandmarkGlyph } from "@/components/LandmarkMarker";
import { GlobeMap, type GlobeHandle, type GlobeMarker } from "@/components/GlobeMap";
import { DoorIcon, FootstepsIcon, PenPaperIcon } from "@/components/ActionIcons";

export default function HomePage() {
  const trips = useTrips();
  const [showCreate, setShowCreate] = useState(false);
  /** 足迹模式：hero 内容淡出、地球滑到左边、右侧出统计面板 */
  const [footprints, setFootprints] = useState(false);
  const globeRef = useRef<GlobeHandle>(null);
  const tripsSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // seed 必须等首次服务端同步完成：
    // 「服务端有数据 + 全新浏览器」时抢先种入示例会顶掉服务端数据
    let live = true;
    whenSynced().then(() => {
      if (live) seedIfEmpty();
    });
    return () => {
      live = false;
    };
  }, []);

  // 足迹数据：每一段旅程的每一个地点各一面旗（与旅行记录卡片同源，不去重）
  const markers = useMemo<GlobeMarker[]>(() => {
    const list: GlobeMarker[] = [];
    for (const t of trips) {
      for (const s of t.stops) {
        list.push({
          id: `${t.id}:${s.id}`,
          longitude: s.longitude,
          latitude: s.latitude,
          name: s.name,
        });
      }
    }
    return list;
  }, [trips]);

  // 足迹统计：基于用户去过的所有地方的总结（处足迹 = 全部行程点总数）
  const stats = useMemo(() => {
    const stops = trips.flatMap((t) => t.stops);
    return {
      trips: trips.length,
      places: stops.length,
      countries: new Set(stops.map((s) => s.country).filter(Boolean)).size,
      cities: new Set(stops.map((s) => s.city).filter(Boolean)).size,
      days: trips.reduce((a, t) => a + tripDays(t), 0),
    };
  }, [trips]);

  // 足迹模式锁住页面滚动（滚轮交给地球缩放），退出时还原
  useEffect(() => {
    document.body.style.overflow = footprints ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [footprints]);

  // 早期地点缺 city/country（统计几个国家/几个城市全靠这两个字段）：
  // 进足迹模式时按坐标逆地理回填并落库，统计数字随之自动变准
  useEffect(() => {
    if (!footprints) return;
    let live = true;
    (async () => {
      for (const t of trips) {
        let changed = false;
        const stops = t.stops.map((s) => ({ ...s }));
        for (const s of stops) {
          if (s.city && s.country) continue;
          if (!live) return;
          try {
            const res = await fetch(`/api/geocode?lat=${s.latitude}&lng=${s.longitude}`);
            const j = await res.json();
            if (j.city || j.country) {
              s.city = s.city ?? j.city;
              s.country = s.country ?? j.country;
              changed = true;
            }
          } catch {
            /* 单个失败跳过，不影响其他地点 */
          }
        }
        if (changed && live) updateTrip(t.id, { stops });
      }
    })();
    return () => {
      live = false;
    };
    // 只在进入足迹模式那一刻跑一次（trips 取当时快照）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footprints]);

  function enterFootprints() {
    // 若正停在旅行记录区，先瞬间回首屏（地球在那里），再开始滑动动画
    window.scrollTo({ top: 0, behavior: "auto" });
    setFootprints(true);
    globeRef.current?.enterFootprints();
  }

  function exitFootprints() {
    setFootprints(false);
    globeRef.current?.exitFootprints();
  }

  function scrollToTrips() {
    tripsSectionRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <main className="home">
      {/* ---- 首屏：整幅旋转地球 + slogan；足迹模式下整个首屏换一副面孔 ---- */}
      <div className={`hero-stage${footprints ? " footprints-mode" : ""}`}>
        <GlobeMap
          ref={globeRef}
          className="hero-globe"
          interactive={false}
          autoRotate
          rotateSpeed={1.0}
          initialCenter={[101, 30]}
          initialZoom={2.15}
          // 宽屏把地球偏到右侧，左边留给 slogan；窄屏居中
          padding={() =>
            window.innerWidth > 960
              ? { left: window.innerWidth * 0.36, top: 0, right: 0, bottom: 0 }
              : undefined
          }
          // 足迹模式：地球滑到左边，右边 42% 留给统计面板
          footprintsPadding={() =>
            window.innerWidth > 960
              ? { left: 0, top: 0, right: window.innerWidth * 0.42, bottom: 0 }
              : undefined
          }
          markers={markers}
          showFlags={footprints}
        />
        <div className="hero-veil" />

        <div className="hero-inner">
          <header className="home-header">
            <div className="brand">
              <span className="brand-mark">
                <LandmarkGlyph icon="oriental-pearl" size={26} />
              </span>
              <span className="font-mono brand-text">TRAVEL&nbsp;STORY</span>
            </div>
            <nav className="home-nav font-mono">
              <span>01 · PLAN</span>
              <span>02 · RECORD</span>
              <span>03 · STORY</span>
            </nav>
          </header>

          <section className="hero">
            <p className="font-mono kicker">YOUR PLAN IS THE SCRIPT</p>
            <h1 className="font-display hero-title">
              人生每一段旅程，
              <br />
              都是一场<span className="accent">电影。</span>
            </h1>
            <p className="hero-sub">
              旅行前规划路线。旅行后上传照片与视频。
              <br />
              系统自动把行程、地图动画和你的素材组合成一部旅行纪录片。
            </p>
            <div className="hero-actions">
              <button className="btn" onClick={() => setShowCreate(true)}>
                <DoorIcon />
                新的旅程
              </button>
              <button className="btn btn-ghost" onClick={scrollToTrips}>
                <PenPaperIcon />
                旅行记录
              </button>
              <button className="btn btn-ghost" onClick={enterFootprints}>
                <FootstepsIcon />
                我的足迹
              </button>
            </div>
          </section>
        </div>

        {/* ---- 足迹模式 UI（默认隐藏，.footprints-mode 下入场上滑/右滑）---- */}
        <div className="fp-top">
          <div className="fp-title">
            <p className="kicker font-mono">FOOTPRINTS AROUND THE WORLD</p>
            <h2 className="font-display">我的足迹</h2>
          </div>
          <button className="fp-close" onClick={exitFootprints} aria-label="返回首页">
            ×
          </button>
        </div>

        <aside className="fp-panel">
          <p className="fp-panel-lead font-mono muted">EVERY PLACE YOU&apos;VE BEEN</p>
          <div className="fp-stats">
            <div className="fp-stat">
              <span className="fp-num font-display">{stats.trips}</span>
              <span className="fp-label">段旅行</span>
            </div>
            <div className="fp-stat">
              <span className="fp-num font-display">{stats.places}</span>
              <span className="fp-label">处足迹</span>
            </div>
            <div className="fp-stat">
              <span className="fp-num font-display">{stats.countries}</span>
              <span className="fp-label">个国家/地区</span>
            </div>
            <div className="fp-stat">
              <span className="fp-num font-display">{stats.cities}</span>
              <span className="fp-label">座城市</span>
            </div>
            <div className="fp-stat">
              <span className="fp-num font-display">{stats.days}</span>
              <span className="fp-label">天旅程</span>
            </div>
          </div>
          <p className="fp-hint font-mono">拖拽转动地球 · 滚轮缩放</p>
        </aside>
      </div>

      {/* ---- 第二屏：旅行记录卡片列表（满屏，点「旅行记录」滑上来）---- */}
      <div className="home-body" ref={tripsSectionRef}>
        <section className="trips">
          <div className="trips-head">
            <h2 className="font-display">旅行记录</h2>
            <div className="trips-head-right">
              <span className="font-mono muted">
                {trips.length} TRIP{trips.length === 1 ? "" : "S"}
              </span>
              <button className="font-mono trips-globe-link" onClick={enterFootprints}>
                我的足迹 →
              </button>
            </div>
          </div>

          {trips.length === 0 ? (
            <div className="empty">
              <p>还没有任何旅行。</p>
              <button className="btn btn-ghost" onClick={() => setShowCreate(true)}>
                创建第一段旅程
              </button>
            </div>
          ) : (
            <div className="trip-grid">
              {trips.map((t, i) => (
                <Link
                  key={t.id}
                  href={`/trip/${t.id}`}
                  className="trip-card fade-up"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div
                    className="trip-card-cover"
                    style={{ background: coverGradient(t.coverHue ?? 20) }}
                  >
                    <span className="font-mono trip-card-no">
                      N°{String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="trip-card-days font-mono">{tripDays(t)} DAYS</span>
                  </div>
                  <div className="trip-card-body">
                    <h3 className="font-display" title={t.name}>
                      {t.name}
                    </h3>
                    <p
                      className="trip-card-meta font-mono muted"
                      title={`${formatDateCN(t.startDate)} — ${formatDateCN(t.endDate)}${t.region ? ` · ${t.region}` : ""}`}
                    >
                      {formatDateCN(t.startDate)} — {formatDateCN(t.endDate)}
                      {t.region ? ` · ${t.region}` : ""}
                    </p>
                    {/* 备注固定占位一行（无备注也占），长了省略、悬停见全文 */}
                    <p
                      className="trip-card-meta trip-card-desc muted"
                      title={t.description || undefined}
                    >
                      {t.description ?? ""}
                    </p>
                    <p
                      className="trip-card-stops"
                      title={
                        t.stops.length > 0
                          ? t.stops.map((s) => s.name).join(" → ")
                          : undefined
                      }
                    >
                      {t.stops.length > 0
                        ? t.stops.map((s) => s.name).join(" → ")
                        : "尚无行程节点"}
                    </p>
                    <button
                      className="trip-card-delete"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirm(`删除「${t.name}」？此操作不可撤销。`)) deleteTrip(t.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <footer className="home-foot font-mono">
          <span>TRAVEL STORY v0.1 · PLAN PREVIEW</span>
          <span>MAP BY OPENFREEMAP · ROUTING BY OSRM</span>
        </footer>
      </div>

      {showCreate && <CreateTripModal onClose={() => setShowCreate(false)} />}
    </main>
  );
}

function coverGradient(hue: number): string {
  const h2 = (hue + 28) % 360;
  return `linear-gradient(135deg, hsl(${hue} 32% 68%) 0%, hsl(${h2} 40% 52%) 100%)`;
}
