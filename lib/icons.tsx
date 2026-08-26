// ============================================================
// Travel Story — 统一图标层（UI 用 React 组件）
//
// UI 用 @phosphor-icons/react（React 组件，支持 weight/color/size）。
// 地图上的车辆/标记需要 data-URL 位图，见 lib/mapIcons.ts（同源 path，
// 无 React 依赖，供非 React 的 map engine 使用）。
//
// 签名地标（东方明珠/外滩/滴水湖）的专属插画仍在 LandmarkMarker.tsx，
// 它们是产品辨识度的一部分，通用图标库不替代。
// ============================================================

import {
  Car,
  Bus,
  TrainRegional,
  Subway,
  AirplaneTilt,
  Boat,
  Sailboat,
  Motorcycle,
  Bicycle,
  Scooter,
  PersonSimpleWalk,
  Horse,
  FlyingSaucer,
  PersonSimpleSwim,
  Rocket as RocketIcon,
  Star,
  Bank,
  Park,
  TreeEvergreen,
  PawPrint,
  Bed,
  Waves,
  WaveSine,
  Island,
  Mountains,
  ForkKnife,
  Buildings,
  Building,
  City,
  Lighthouse,
  CastleTurret,
  Bridge,
  FlowerLotus,
  Umbrella,
  MapPin,
  ImageSquare,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import type { StopType, Transport } from "./types";

// 地图引擎用的 data-URL 图标在 lib/mapIcons.ts（无 React 依赖）。
// 这里 re-export 一份，方便 React 侧统一从 @/lib/icons 取。
export { vehicleIconSvg, stopTypeIconSvg, iconDataUrl } from "./mapIcons";

// ------------------------------------------------------------
// React 组件映射（时间线 chip、场记卡等 UI 用）
// ------------------------------------------------------------

export const TRANSPORT_ICON: Record<Transport, PhosphorIcon> = {
  car: Car,
  bus: Bus,
  train: TrainRegional,
  subway: Subway,
  plane: AirplaneTilt,
  ship: Boat,
  kayak: Sailboat, // Phosphor 没有皮划艇，小帆船是气质最近的「人力小艇」
  motorcycle: Motorcycle,
  bicycle: Bicycle,
  scooter: Scooter,
  walk: PersonSimpleWalk,
  horse: Horse,
  ufo: FlyingSaucer,
  swim: PersonSimpleSwim,
  rocket: RocketIcon,
};

export function TransportGlyph({
  transport,
  size = 20,
  weight = "fill",
  color,
}: {
  transport: Transport;
  size?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  color?: string;
}) {
  const Icon = TRANSPORT_ICON[transport] ?? Car;
  return <Icon size={size} weight={weight} color={color} />;
}

export const STOP_TYPE_ICON: Record<StopType, PhosphorIcon> = {
  attraction: Star,
  museum: Bank,
  park: Park,
  zoo: PawPrint,
  hotel: Bed,
  airport: AirplaneTilt,
  station: TrainRegional,
  beach: Umbrella,
  lake: Waves,
  mountain: Mountains,
  restaurant: ForkKnife,
  scenic: ImageSquare,
  city: City,
  tower: Lighthouse,
  skyscraper: Building,
  skyline: Buildings,
  garden: FlowerLotus,
  forest: TreeEvergreen,
  river: WaveSine,
  sea: Island,
  temple: CastleTurret,
  bridge: Bridge,
  other: MapPin,
};

export function StopTypeGlyph({
  type,
  size = 20,
  weight = "fill",
  color,
}: {
  type: StopType;
  size?: number;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  color?: string;
}) {
  const Icon = STOP_TYPE_ICON[type] ?? MapPin;
  return <Icon size={size} weight={weight} color={color} />;
}
