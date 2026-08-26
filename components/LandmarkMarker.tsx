"use client";

// ============================================================
// Travel Story — 地标标记（HTML Overlay 层）
//
// 需求文档 §12/§47：地标不能只是普通 Pin，要「不看文字也大致知道这是哪里」。
//  - signature（签名地标，如东方明珠）：专属手绘插画徽章 + 朱砂 pulse 光晕；
//  - category（按类型）：圆形墨底 + Phosphor 专业线性图标（14 类全覆盖）；
//  - 标记永远浮在地图上，z-index 高于底图（§11）。
// ============================================================

import type { LandmarkIcon } from "@/lib/landmark";
import { StopTypeGlyph } from "@/lib/icons";
import type { StopType } from "@/lib/types";

const INK = "#26211A";
const PAPER = "#F6F1E4";
const ACCENT = "#E4572E";

/** 类别图标键 → StopType（用 Phosphor 统一渲染） */
const CATEGORY_TYPE: Partial<Record<LandmarkIcon, StopType>> = {
  attraction: "attraction",
  museum: "museum",
  park: "park",
  hotel: "hotel",
  airport: "airport",
  station: "station",
  beach: "beach",
  lake: "lake",
  mountain: "mountain",
  restaurant: "restaurant",
  scenic: "scenic",
  tower: "tower",
  skyscraper: "skyscraper",
  skyline: "skyline",
  garden: "garden",
  forest: "forest",
  river: "river",
  sea: "sea",
  temple: "temple",
  bridge: "bridge",
  other: "other",
};

export function LandmarkGlyph({ icon, size = 34 }: { icon: LandmarkIcon; size?: number }) {
  switch (icon) {
    // ---- 签名地标：专属手绘插画（产品辨识度，保留） ----
    case "oriental-pearl":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
          {/* 东方明珠：双球电视塔，辨识度最高的剪影 */}
          <circle cx="24" cy="40" r="2.2" fill={INK} />
          <path d="M24 38 V30" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
          <ellipse cx="24" cy="28" rx="7.5" ry="5" fill={INK} />
          <ellipse cx="24" cy="27.2" rx="4.2" ry="2.2" fill={ACCENT} opacity="0.85" />
          <path d="M24 23 V16" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
          <ellipse cx="24" cy="14" rx="4" ry="3" fill={INK} />
          <ellipse cx="24" cy="13.4" rx="2" ry="1.2" fill={ACCENT} opacity="0.8" />
          <path d="M24 11 V5 M22 7 L26 7 M23 9 L25 9" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M17 33 L24 38 L31 33" stroke={INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "bund":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
          {/* 外滩：万国建筑群剪影 + 江面 */}
          <path d="M6 30 L9 22 L12 30 Z" fill={INK} />
          <rect x="12" y="18" width="6" height="16" rx="0.6" fill={INK} />
          <rect x="18" y="14" width="7" height="20" rx="0.6" fill={INK} />
          <rect x="25" y="20" width="6" height="14" rx="0.6" fill={INK} />
          <path d="M31 26 L36 16 L41 26 Z" fill={INK} />
          <rect x="14" y="22" width="2" height="2" fill={PAPER} />
          <rect x="14" y="27" width="2" height="2" fill={PAPER} />
          <rect x="20" y="18" width="2" height="2" fill={PAPER} />
          <rect x="23" y="18" width="2" height="2" fill={PAPER} />
          <rect x="20" y="23" width="2" height="2" fill={PAPER} />
          <rect x="27" y="24" width="2" height="2" fill={PAPER} />
          <path d="M6 36 Q14 34 22 36 T40 36" stroke={ACCENT} strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <path d="M6 40 Q14 38 22 40 T40 40" stroke="#B4CBD2" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        </svg>
      );
    case "dishui-lake":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
          {/* 滴水湖：圆形湖泊 + 中心水滴 + 环道 */}
          <circle cx="24" cy="24" r="16" stroke="#B4CBD2" strokeWidth="1.6" fill="#E1EDF1" />
          <circle cx="24" cy="24" r="10" stroke={ACCENT} strokeWidth="1.2" strokeDasharray="2 2" fill="none" opacity="0.7" />
          <path d="M24 15 C20 21 18 24 18 27 a6 6 0 0 0 12 0 c0-3-2-6-6-12 Z" fill={INK} />
          <ellipse cx="22" cy="25" rx="1.6" ry="2.4" fill="#9FC0C8" opacity="0.7" />
        </svg>
      );
    case "zoo":
      return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
          {/* 动物园：动物爪印 */}
          <circle cx="24" cy="28" r="9" fill={INK} />
          <ellipse cx="24" cy="28" rx="4" ry="3.2" fill={PAPER} />
          <circle cx="15" cy="20" r="3" fill={INK} />
          <circle cx="21" cy="15" r="3" fill={INK} />
          <circle cx="27" cy="15" r="3" fill={INK} />
          <circle cx="33" cy="20" r="3" fill={INK} />
        </svg>
      );

    // ---- 类别图标：墨色圆底 + Phosphor 专业图标 ----
    case "attraction":
    case "museum":
    case "park":
    case "hotel":
    case "airport":
    case "station":
    case "beach":
    case "lake":
    case "mountain":
    case "restaurant":
    case "scenic":
    case "other":
    case "fallback":
    default: {
      const t = CATEGORY_TYPE[icon] ?? "other";
      return (
        <span
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            background: INK,
            color: PAPER,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <StopTypeGlyph type={t} size={Math.round(size * 0.56)} weight="fill" color={PAPER} />
        </span>
      );
    }
  }
}

// ============================================================
// 标记容器：SVG 徽章 + 「DAY 01」标签 + 签名地标 pulse 光晕
// ============================================================

export function LandmarkMarker({
  icon,
  day,
  name,
  kind = "category",
  active = false,
  dimmed = false,
}: {
  icon: LandmarkIcon;
  day?: number;
  name: string;
  kind?: "signature" | "category" | "fallback";
  active?: boolean;
  dimmed?: boolean;
}) {
  const isSig = kind === "signature";
  const glyphSize = isSig ? 48 : 38;
  return (
    <div
      className="ts-marker"
      data-active={active || undefined}
      data-dimmed={dimmed || undefined}
      style={{ opacity: dimmed ? 0.4 : 1, transform: "translate(-50%, -100%)" }}
    >
      {isSig && <span className="ts-marker-pulse" style={{ borderColor: ACCENT }} />}
      <span
        className="ts-marker-shield"
        style={{
          background: isSig ? PAPER : "transparent",
          border: isSig ? `1.5px solid ${INK}` : "none",
          boxShadow: isSig ? "0 6px 18px rgba(38,33,26,.22)" : "0 4px 10px rgba(38,33,26,.18)",
          padding: isSig ? 4 : 0,
        }}
      >
        <LandmarkGlyph icon={icon} size={glyphSize} />
      </span>
      {day != null && (
        <span
          className="ts-marker-day"
          style={{
            background: active ? ACCENT : INK,
            color: PAPER,
            borderColor: PAPER,
          }}
        >
          DAY {String(day).padStart(2, "0")}
        </span>
      )}
      <span className="ts-marker-name">{name}</span>
    </div>
  );
}
