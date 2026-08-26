// ============================================================
// Travel Story — 地标系统（LandmarkService）
//
// 需求文档 §12/§13/§47：地标不能只是普通 Pin。
// 三级资产策略 + 降级机制：
//   Level 2 签名地标（按名称匹配，如东方明珠 → 专属插画）
//   Level 1 类别图标（细分类：先按名称关键词精分，如「静安寺」→ 寺庙；
//          名称没命中再按地理编码给的类型兜底）
//   Fallback 通用图标（保证任何地点都能明显显示）
//
// 这里只负责「匹配 → 返回图标标识 / 细分类型」，实际 SVG 美术在
// LandmarkMarker.tsx 的 LandmarkGlyph，保持数据与视图分离。
// ============================================================

import type { StopType } from "./types";

export type LandmarkIcon =
  // 签名地标（Level 2）
  | "oriental-pearl"
  | "bund"
  | "zoo"
  | "dishui-lake"
  // 类别图标（Level 1，与 StopType 同名一一对应）
  | "attraction"
  | "museum"
  | "park"
  | "hotel"
  | "airport"
  | "station"
  | "beach"
  | "lake"
  | "mountain"
  | "restaurant"
  | "scenic"
  | "tower"
  | "skyscraper"
  | "skyline"
  | "garden"
  | "forest"
  | "river"
  | "sea"
  | "temple"
  | "bridge"
  | "other"
  // 通用兜底
  | "fallback";

export interface LandmarkSpec {
  icon: LandmarkIcon;
  kind: "signature" | "category" | "fallback";
}

interface SignatureRule {
  icon: LandmarkIcon;
  /** 名称包含这些关键词即命中（大小写不敏感） */
  keys: string[];
  /** 可选：限定类型 */
  type?: StopType;
}

const SIGNATURES: SignatureRule[] = [
  { icon: "oriental-pearl", keys: ["东方明珠", "东方明珠广播电视塔", "明珠塔"] },
  { icon: "bund", keys: ["外滩", "the bund", "黄浦滩", "万国建筑"] },
  { icon: "dishui-lake", keys: ["滴水湖"] },
];

// ------------------------------------------------------------
// 名称关键词细分类（Level 1 的主力）
//
// 排序即优先级（先命中先得），同一类型里：
//  - includes：名称包含多字关键词（较安全）
//  - endsWith：名称以单字结尾（「黄浦江」「西湖」「佘山」这类
//    专名才这么收，避免「锦江饭店」被误判成江河）
// ------------------------------------------------------------

interface CategoryRule {
  type: StopType;
  includes?: string[];
  endsWith?: string[];
}

const CATEGORY_RULES: CategoryRule[] = [
  { type: "museum", includes: ["博物馆", "博物院", "纪念馆", "展览馆", "美术馆", "museum"] },
  { type: "zoo", includes: ["动物园", "zoo"] },
  { type: "hotel", includes: ["酒店", "宾馆", "旅馆", "客栈", "民宿", "度假村", "饭店", "hotel", "resort"] },
  { type: "restaurant", includes: ["餐厅", "菜馆", "酒楼", "美食", "小吃", "restaurant"] },
  { type: "temple", includes: ["寺庙", "寺院", "佛寺", "temple"], endsWith: ["寺", "庙"] },
  { type: "tower", includes: ["电视塔", "观景塔", "灯塔", "tower"], endsWith: ["塔"] },
  { type: "skyscraper", includes: ["大厦", "大楼", "双子塔", "金融中心", "skyscraper"] },
  { type: "skyline", includes: ["建筑群", "天际线", "skyline"] },
  { type: "sea", includes: ["海洋", "海岸", "海边", "海岛", "海上", "ocean"], endsWith: ["海", "湾", "岛"] },
  { type: "beach", includes: ["沙滩", "海滩", "beach"] },
  { type: "forest", includes: ["森林", "林场", "forest"] },
  // 公园要在园林之前：「中山公园」「迪士尼乐园」先归公园/乐园，
  // 剩下的 X园（拙政园/豫园/颐和园）才归古典园林
  { type: "park", includes: ["公园", "乐园", "park"] },
  { type: "garden", includes: ["园林", "园博园", "花园", "garden"], endsWith: ["园"] },
  { type: "airport", includes: ["机场", "airport"] },
  { type: "station", includes: ["火车站", "高铁站", "汽车站", "客运站", "station"], endsWith: ["站"] },
  { type: "bridge", includes: ["大桥", "桥梁", "桥"], endsWith: ["桥"] },
  { type: "river", includes: ["river"], endsWith: ["江", "河", "溪"] },
  { type: "lake", includes: ["lake"], endsWith: ["湖"] },
  { type: "mountain", includes: ["mountain", "mount "], endsWith: ["山", "峰"] },
];

const CATEGORY_ICON: Record<StopType, LandmarkIcon> = {
  attraction: "attraction",
  museum: "museum",
  park: "park",
  zoo: "zoo",
  hotel: "hotel",
  airport: "airport",
  station: "station",
  beach: "beach",
  lake: "lake",
  mountain: "mountain",
  restaurant: "restaurant",
  scenic: "scenic",
  city: "scenic",
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

/** 名称关键词命中的细分类；没命中返回 null */
function classifyByName(name: string): StopType | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  for (const rule of CATEGORY_RULES) {
    if (rule.includes?.some((k) => n.includes(k.toLowerCase()))) return rule.type;
    if (rule.endsWith?.some((k) => n.endsWith(k.toLowerCase()))) return rule.type;
  }
  return null;
}

/**
 * 精分显示类型：名称关键词优先，地理编码类型兜底。
 * 用于时间线等处的类别标签（地理编码的 class 很粗，
 * 「上海东方宾馆」在 OSM 里只是 building，靠名称才能认出是酒店）。
 */
export function refineType(name: string, type: StopType): StopType {
  return classifyByName(name) ?? type;
}

export const landmark: {
  match(name: string, type: StopType): LandmarkSpec;
} = {
  match(name, type) {
    const n = name.trim().toLowerCase();
    for (const rule of SIGNATURES) {
      if (rule.type && rule.type !== type) continue;
      if (rule.keys.some((k) => n.includes(k.toLowerCase()))) {
        return { icon: rule.icon, kind: "signature" };
      }
    }
    return { icon: CATEGORY_ICON[refineType(name, type)] ?? "other", kind: "category" };
  },
};

/** 初版：仅上海四日游演示有签名插画，其余地点保证可用类别图标 */
export function hasSignatureArt(icon: LandmarkIcon): boolean {
  return icon === "oriental-pearl" || icon === "bund" || icon === "zoo" || icon === "dishui-lake";
}
