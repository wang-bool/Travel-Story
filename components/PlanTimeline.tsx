"use client";

// 规划页左侧：按 Day 分组的时间线。
// - 每个 stop 一张卡片：图标 / 名称 / 城市 / 类型 / 素材上传 / 删除
// - stop 之间是紧凑的交通方式选择器（当前项小胶囊，点开弹九宫格面板）
// - 支持拖拽排序（同 Day 内）与跨 Day 移动（拖到另一个 Day 的列表）
// - 每个 Day 底部「+ 添加地点」

import { useEffect, useRef, useState } from "react";
import { PlaceSearch } from "./PlaceSearch";
import { LandmarkGlyph } from "./LandmarkMarker";
import { StopMedia } from "./StopMedia";
import { landmark, refineType } from "@/lib/landmark";
import { TRANSPORT_META, STOP_TYPE_LABEL } from "@/lib/types";
import type { Transport, Trip, TripStop } from "@/lib/types";
import { TransportGlyph } from "@/lib/icons";

export function PlanTimeline({
  trip,
  selectedStopId,
  onSelectStop,
  onAddStop,
  onRemoveStop,
  onMoveStop,
  onSetTransport,
  onAddDay,
  onRemoveDay,
  onHoverSearch,
  onAddMedia,
  onRemoveMedia,
}: {
  trip: Trip;
  selectedStopId?: string | null;
  onSelectStop: (stop: TripStop) => void;
  onAddStop: (dayId: string, result: import("@/lib/types").SearchResult) => void;
  onRemoveStop: (stopId: string) => void;
  onMoveStop: (stopId: string, targetDayId: string, targetIndex: number) => void;
  onSetTransport: (fromStopId: string, transport: Transport) => void;
  onAddDay: () => void;
  onRemoveDay: (dayId: string) => void;
  onHoverSearch?: (r: import("@/lib/types").SearchResult | null) => void;
  onAddMedia?: (stopId: string, files: File[]) => void;
  onRemoveMedia?: (stopId: string, mediaId: string) => void;
}) {
  const [addingForDay, setAddingForDay] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const stopsByDay = new Map<string, TripStop[]>();
  for (const s of trip.stops) {
    const list = stopsByDay.get(s.dayId) ?? [];
    list.push(s);
    stopsByDay.set(s.dayId, list);
  }
  const segByFrom = new Map(trip.segments.map((s) => [s.fromStopId, s]));

  return (
    <div className="timeline">
      {trip.days.map((day) => {
        const stops = stopsByDay.get(day.id) ?? [];
        return (
          <section
            key={day.id}
            className="day-block"
            onDragOver={(e) => {
              if (dragId) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragId) return;
              onMoveStop(dragId, day.id, stops.length);
              setDragId(null);
            }}
          >
            <div className="day-head">
              <div>
                <span className="font-mono day-label">DAY {String(day.day).padStart(2, "0")}</span>
                <span className="day-date font-mono muted">{day.date}</span>
              </div>
              {trip.days.length > 1 && (
                <button
                  className="day-remove font-mono"
                  title="删除这一天"
                  onClick={() => {
                    if (confirm(`删除 Day ${day.day} 及其所有地点？`)) onRemoveDay(day.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            <ol className="stop-list">
              {stops.map((stop, i) => {
                const seg = segByFrom.get(stop.id);
                const spec = landmark.match(stop.name, stop.type);
                const isLast = i === stops.length - 1 && day === trip.days[trip.days.length - 1];
                return (
                  <li key={stop.id}>
                    <div
                      className={`stop-card ${selectedStopId === stop.id ? "active" : ""}`}
                      draggable
                      onDragStart={() => setDragId(stop.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => onSelectStop(stop)}
                    >
                      <span className="stop-handle" title="拖动排序">
                        ⋮⋮
                      </span>
                      <span className="stop-glyph">
                        <LandmarkGlyph icon={spec.icon} size={28} />
                      </span>
                      <div className="stop-info">
                        <span className="stop-name">{stop.name}</span>
                        <span className="stop-meta font-mono muted">
                          {[stop.city, STOP_TYPE_LABEL[refineType(stop.name, stop.type)]].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <button
                        className="stop-remove"
                        title="删除地点"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveStop(stop.id);
                        }}
                      >
                        ×
                      </button>
                    </div>

                    {/* 素材：图片/视频缩略图 + 上传（供日后生成纪录片用） */}
                    <StopMedia
                      stop={stop}
                      onAddFiles={(files) => onAddMedia?.(stop.id, files)}
                      onRemove={(mediaId) => onRemoveMedia?.(stop.id, mediaId)}
                    />

                    {/* 交通方式只在「同一天内还有下一个节点」时显示；
                        每天的最后一个节点不翻篇到明天，后面没有了就不显示 */}
                    {seg && i < stops.length - 1 && (
                      <div className="segment">
                        <div className="segment-line" />
                        <TransportPicker
                          value={seg.transport}
                          onChange={(t) => onSetTransport(stop.id, t)}
                        />
                        <div className="segment-line" />
                      </div>
                    )}
                    {isLast && null}
                  </li>
                );
              })}
            </ol>

            {addingForDay === day.id ? (
              <div className="add-stop">
                <PlaceSearch
                  onPick={(r) => {
                    onAddStop(day.id, r);
                    setAddingForDay(null);
                  }}
                  onCancel={() => setAddingForDay(null)}
                  onHover={onHoverSearch}
                />
              </div>
            ) : (
              <button className="add-stop-btn" onClick={() => setAddingForDay(day.id)}>
                ＋ 添加地点
              </button>
            )}
          </section>
        );
      })}

      <button className="add-day-btn" onClick={onAddDay}>
        ＋ 添加一天
      </button>
    </div>
  );
}

/**
 * 紧凑交通方式选择器：默认只占一颗小胶囊（当前方式），
 * 点击弹出 4 列网格面板展示全部选项，选完/点外面自动收起。
 */
function TransportPicker({
  value,
  onChange,
}: {
  value: Transport;
  onChange: (t: Transport) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<"up" | "down">("up");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // 面板高约 250px：比上下两侧空间，哪边够往哪边开；都不够就往大的那边开
  const toggle = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceUp = rect.top - 70; // 顶栏
      const spaceDown = window.innerHeight - rect.bottom - 12;
      setDir(spaceUp >= 270 || spaceUp >= spaceDown ? "up" : "down");
    }
    setOpen((o) => !o);
  };

  return (
    <div className="tspick" ref={ref}>
      <button className="tspick-current" onClick={toggle} title="更换交通方式">
        <TransportGlyph transport={value} size={15} weight="fill" />
        <span>{TRANSPORT_META[value].label}</span>
        <span className="tspick-caret">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className={`tspick-pop fade-up ${dir}`}>
          {(Object.keys(TRANSPORT_META) as Transport[]).map((t) => (
            <button
              key={t}
              className={`tspick-item ${t === value ? "active" : ""}`}
              onClick={() => {
                onChange(t);
                setOpen(false);
              }}
              title={TRANSPORT_META[t].label}
            >
              <TransportGlyph transport={t} size={19} weight={t === value ? "fill" : "regular"} />
              <span>{TRANSPORT_META[t].label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
