// ============================================================
// Travel Story — 领域模型
// 遵循需求文档 §44「推荐领域模型」：Trip → TripDay → TripStop，
// 以及 TripSegment（两两地点之间的行程段）。
// ============================================================

/**
 * 交通方式（穷举，需求文档 §15 扩展）。
 * 每种方式对应一个 Phosphor 图标和一个路线 Profile，见 TRANSPORT_META / routing.ts。
 * 历史数据里只存字符串，新增值不会破坏旧行程（旧值继续有效）。
 */
export type Transport =
  | "car"
  | "bus"
  | "train"
  | "subway"
  | "plane"
  | "ship"
  | "kayak"
  | "motorcycle"
  | "bicycle"
  | "scooter"
  | "walk"
  | "horse"
  // 幻想/趣味交通（旅游要开心）
  | "ufo"
  | "swim"
  | "rocket";

/** 地点类型（需求文档 §13 Level 1 分类，细分类版本：
 *  穷举每个景点不现实，但细分归类可以覆盖绝大多数：
 *  塔/高楼/建筑群/园林/森林/江河/海洋/寺庙/桥梁… 均按名称关键词命中，见 landmark.ts） */
export type StopType =
  | "attraction"
  | "museum"
  | "park"
  | "zoo"
  | "hotel"
  | "airport"
  | "station"
  | "beach"
  | "lake"
  | "mountain"
  | "restaurant"
  | "scenic"
  | "city"
  // 细分类（第二梯队）
  | "tower"
  | "skyscraper"
  | "skyline"
  | "garden"
  | "forest"
  | "river"
  | "sea"
  | "temple"
  | "bridge"
  | "other";

export interface TripDay {
  id: string;
  /** 1-based 第几天 */
  day: number;
  /** YYYY-MM-DD */
  date: string;
}

export interface TripStop {
  id: string;
  dayId: string;
  /** 冗余 day，便于快速渲染 */
  day: number;
  name: string;
  city?: string;
  country?: string;
  latitude: number;
  longitude: number;
  type: StopType;
  /** Day 内排序（0-based） */
  order: number;
  /** 该地点上传的图片/视频素材元数据；二进制保存在服务端 data/media/ */
  media?: MediaMeta[];
}

/** 素材元数据。二进制本体由 /api/media 写入服务端，不进入 localStorage */
export interface MediaMeta {
  id: string;
  kind: "image" | "video";
  /** 原始文件名（仅展示用） */
  name: string;
  createdAt: number;
}

/** 路段几何（需求文档 §45：GeoJSON LineString） */
export interface RouteGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface TripSegment {
  id: string;
  fromStopId: string;
  toStopId: string;
  transport: Transport;
  route: RouteGeometry | null;
  distance?: number;
  duration?: number;
}

export interface Trip {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  origin?: string;
  region?: string;
  description?: string;
  isPublic: boolean;
  /** 封面用渐变色种子（初版无真实封面图） */
  coverHue?: number;
  createdAt: number;
  days: TripDay[];
  stops: TripStop[];
  segments: TripSegment[];
}

/** 地点搜索候选（需求文档 §7） */
export interface SearchResult {
  id: string;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  type: StopType;
  city?: string;
  country?: string;
}

export const TRANSPORT_META: Record<Transport, { label: string; short: string }> = {
  car: { label: "汽车", short: "CAR" },
  bus: { label: "巴士", short: "BUS" },
  train: { label: "火车", short: "TRAIN" },
  subway: { label: "地铁", short: "METRO" },
  plane: { label: "飞机", short: "FLIGHT" },
  ship: { label: "轮船", short: "SHIP" },
  kayak: { label: "皮划艇", short: "KAYAK" },
  motorcycle: { label: "摩托", short: "MOTO" },
  bicycle: { label: "自行车", short: "BIKE" },
  scooter: { label: "电动车", short: "SCOOT" },
  walk: { label: "步行", short: "WALK" },
  horse: { label: "骑马", short: "HORSE" },
  ufo: { label: "飞碟", short: "UFO" },
  swim: { label: "游泳", short: "SWIM" },
  rocket: { label: "火箭", short: "ROCKET" },
};

/** 交通方式在路线服务里的类别（决定走真实道路 / 大圆 / 直线） */
export type TransportKind = "road" | "rail" | "air" | "water" | "foot";
export const TRANSPORT_KIND: Record<Transport, TransportKind> = {
  car: "road",
  bus: "road",
  motorcycle: "road",
  scooter: "road",
  bicycle: "road",
  train: "rail",
  subway: "rail",
  walk: "foot",
  horse: "foot",
  plane: "air",
  ship: "water",
  kayak: "water",
  ufo: "air",
  rocket: "air",
  swim: "water",
};

export const STOP_TYPE_LABEL: Record<StopType, string> = {
  attraction: "景点",
  museum: "博物馆",
  park: "公园",
  zoo: "动物园",
  hotel: "酒店",
  airport: "机场",
  station: "车站",
  beach: "海滩",
  lake: "湖泊",
  mountain: "山",
  restaurant: "餐厅",
  scenic: "风景区",
  city: "城市",
  tower: "高塔",
  skyscraper: "高楼",
  skyline: "建筑群",
  garden: "园林",
  forest: "森林",
  river: "江河",
  sea: "海洋",
  temple: "寺庙",
  bridge: "桥梁",
  other: "其他",
};
