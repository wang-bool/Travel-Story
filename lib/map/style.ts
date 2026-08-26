// ============================================================
// Travel Story — 叙事极简底图（Base Map Style）
//
// 需求文档 §8/§10/§48：
//  地图是旅行故事的背景，不是导航工具。
//  只保留「足够的地理环境让用户知道自己在哪」：
//    保留：水体 / 主要道路 / 少量地铁 / 少量重要地名 / 城市区域 / 海岸线
//    隐藏：POI / 建筑 / 小社区 / 银行超市等无关信息
//
// 基于 OpenFreeMap（OSM 派生，免费无需 key）的 openmaptiles 矢量源，
// 在其上做一层「叙事化」的图层裁剪与配色。
// ============================================================

import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

// ------------------------------------------------------------
// 底图数据源（唯一配置点，方便未来切换）
//
// ⚠️ 合规说明：当前 OpenFreeMap 是 OSM 社区数据，边界画法不保证符合
// 中国官方标准。已与用户确认：个人/内部演示阶段先维持现状；
// 若正式上线面向公众，需切换到带审图号的官方图源（天地图/高德等）。
//
// 「国际」模式的矢量瓦片/字体一律走本地代理 /api/tiles（磁盘缓存 →
// 本地 MBTiles → 回源，见 app/api/tiles/[...path]/route.ts），
// 下面的 UPSTREAM 只被该代理用作回源地址。
// ------------------------------------------------------------
export const TILES_UPSTREAM = "https://tiles.openfreemap.org";
const MAP_TILES_URL = "/api/tiles/planet";
const MAP_GLYPHS_URL = "/api/tiles/fonts/{fontstack}/{range}.pbf";

// ------------------------------------------------------------
// 底图模式（界面右上角一键切换，见 TravelMap）：
//  domestic      国内 → 高德栅格瓦片：实测 0.04~0.1s/片，极快。
//                代价：① 官方导航风样式，失去叙事极简样式；
//                ② GCJ-02 火星坐标，WGS-84 的站点/路线/车辆叠上去
//                偏 ~300-600m（车会开在路旁边）；
//                ③ 国外 z8+ 无数据（实测为空白占位图）；
//                ④ 免 key 直连属灰色用法，正式用需走官方 JS API。
//  international 国际 → OpenFreeMap 矢量：自定义样式、WGS-84 无偏移、
//                全球覆盖；配合本地代理缓存后速度不再是问题。
// ------------------------------------------------------------
export type BaseMode = "domestic" | "international";

export function styleForMode(mode: BaseMode): StyleSpecification {
  return mode === "domestic" ? RASTER_STYLE : VECTOR_STYLE;
}

const VECTOR_STYLE: StyleSpecification = {
  version: 8,
  name: "Travel Story — Narrative Base",
  glyphs: MAP_GLYPHS_URL,
  sources: {
    openmaptiles: {
      type: "vector",
      url: MAP_TILES_URL,
    },
  },
  // v5 默认 globe，初版锁定平面投影保证城市视角干净。
  // 写进 style 而非在 load 前 setProjection（后者会抛异常）。
  projection: { type: "mercator" as const },
  layers: [
    // ---- 底色：暖纸色 ----
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#F6F1E4" },
    },

    // ---- 水体 ----
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      filter: ["all", ["==", ["geometry-type"], "Polygon"]],
      paint: { "fill-color": "#C9DDE3" },
    },
    {
      id: "water-outline",
      type: "line",
      source: "openmaptiles",
      "source-layer": "water",
      filter: ["all", ["==", ["geometry-type"], "Polygon"]],
      paint: { "line-color": "#B4CBD2", "line-width": 0.7 },
    },
    {
      id: "water-way",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      filter: ["all", ["in", "class", "river", "canal"]],
      paint: { "line-color": "#BED4DB", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 14, 2.4] },
    },

    // ---- 土地利用：极淡的绿（公园/森林） ----
    {
      id: "landcover",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      filter: ["in", "class", "forest", "wood"],
      paint: { "fill-color": "#E3E9D7", "fill-opacity": 0.9 },
    },
    {
      id: "landuse-park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      filter: ["in", "class", "park", "recreation", "grass"],
      paint: { "fill-color": "#E6EBDC", "fill-opacity": 0.85 },
    },
    {
      id: "landuse-beach",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      filter: ["==", "class", "beach"],
      paint: { "fill-color": "#F0E6CD" },
    },

    // ---- 边界：国界 / 省（州）界 两级，极淡、不喧宾夺主 ----
    // 只画陆地边界（maritime=0）；争议段与国界同式呈现，不单独突出。
    {
      id: "boundary-country",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["all", ["==", "admin_level", 2], ["==", "maritime", 0]],
      paint: {
        "line-color": "#C4B492",
        "line-width": ["interpolate", ["linear"], ["zoom"], 1.5, 0.6, 6, 1.4],
      },
    },
    {
      id: "boundary-state",
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: ["all", ["in", "admin_level", 3, 4], ["==", "maritime", 0]],
      minzoom: 3.5,
      paint: {
        "line-color": "#DACDAE",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3.5, 0.4, 8, 0.9],
        "line-dasharray": [3, 2.4],
      },
    },

    // ---- 道路：只保留高速/主干，细而淡（叙事背景，不抢戏） ----
    ...roadLayers("road-motorway", "motorway", 2.6, "#FFFFFF", "#E0D6BE"),
    ...roadLayers("road-trunk", "trunk", 2.2, "#FFFFFF", "#E4DCC6"),
    ...roadLayers("road-primary", "primary", 1.8, "#FBF7EC", "#E8E0CB"),
    ...roadLayers("road-secondary", "secondary", 1.4, "#F5F0E2"),

    // ---- 铁路 / 地铁（少量，细虚线） ----
    {
      id: "railway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["all", ["==", "$type", "LineString"], ["in", "class", "rail", "transit"]],
      paint: {
        "line-color": "#E2D6BE",
        "line-width": 0.8,
        "line-dasharray": [2, 2],
      },
    },

    // ---- 机场跑道（极淡） ----
    {
      id: "aeroway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "aeroway",
      filter: ["in", "class", "runway"],
      paint: { "line-color": "#E8DFC8", "line-width": 2 },
    },

    // ---- 重要水体名称（斜体、淡蓝） ----
    {
      id: "water-name",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "water_name",
      filter: ["in", "class", "ocean", "lake", "river", "sea"],
      minzoom: 7,
      layout: {
        "text-field": textField(),
        "text-font": ["Noto Sans Italic"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 7, 9, 12, 12],
        "text-letter-spacing": 0.05,
        "text-max-width": 12,
        "text-rotation-alignment": "map",
        "symbol-placement": "line",
      },
      paint: {
        "text-color": "#7FA0AA",
        "text-halo-color": "#F6F1E4",
        "text-halo-width": 1.5,
      },
    },

    // ---- 背景地名按 zoom 分级：洲 → 国 → 省/州 → 市 → 区/镇 ----
    //      全部淡化为背景，醒目程度不得盖过行程点（墨色加粗的 LandmarkMarker）
    // 洲际视野：大洲名
    {
      id: "place-continent",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["==", "class", "continent"],
      minzoom: 0.5,
      maxzoom: 4,
      layout: {
        "text-field": textField(),
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 1, 12, 3, 16],
        "text-letter-spacing": 0.4,
        "text-transform": "uppercase",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#A69B80",
        "text-halo-color": "#F6F1E4",
        "text-halo-width": 2,
      },
    },
    // 国家（洲际→国家级视野）
    {
      id: "place-country",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["==", "class", "country"],
      minzoom: 2,
      maxzoom: 6.5,
      layout: {
        "text-field": textField(),
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 13],
        "text-letter-spacing": 0.3,
        "text-transform": "uppercase",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#AFA48B",
        "text-halo-color": "#F6F1E4",
        "text-halo-width": 1.6,
      },
    },
    {
      id: "place-state",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["==", "class", "state"],
      minzoom: 3.5,
      maxzoom: 8.5,
      layout: {
        "text-field": textField(),
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 9, 8, 11],
        "text-letter-spacing": 0.15,
        "text-transform": "uppercase",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#B5AA92",
        "text-halo-color": "#F6F1E4",
        "text-halo-width": 1.5,
      },
    },
    {
      id: "place-city",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["==", "class", "city"],
      minzoom: 5,
      layout: {
        "text-field": textField(),
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10.5, 12, 15],
        "text-letter-spacing": 0.04,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#968B6F",
        "text-halo-color": "#F6F1E4",
        "text-halo-width": 1.8,
      },
    },
    {
      id: "place-town",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      filter: ["==", "class", "town"],
      minzoom: 10,
      layout: {
        "text-field": textField(),
        "text-font": ["Noto Sans Regular"],
        "text-size": 9.5,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#B0A48A",
        "text-halo-color": "#F6F1E4",
        "text-halo-width": 1.4,
      },
    },
  ],
};

// ------------------------------------------------------------
// 帮助函数
// ------------------------------------------------------------

/**
 * 地名取值：优先中文（简体），且只显一种写法。
 *   1. 台湾单列：无论底层数据是 台灣/台湾/臺灣/Taiwan，一律显示「中国台湾」；
 *   2. 简体优先：有 name:zh-Hans 直接用（OSM 的 name:zh 常是繁体或简繁拼一起）；
 *   3. 退回 name:zh：OSM 常把「简体/繁體」拼在一个标签里（如 俄罗斯/俄羅斯），
 *      按 ";" 和 "/" 切开只取第一段（惯例简体在前）；
 *   4. 都没有时退回英文/国际名。
 */
function textField() {
  const zhName = [
    "coalesce",
    ["get", "name:zh-Hans"],
    ["get", "name:zh"],
    ["get", "name:en"],
    ["get", "name_int"],
    ["get", "name"],
  ];
  const firstOf = (field: string) => [
    "to-string",
    ["at", 0, ["split", ["to-string", ["at", 0, ["split", ["get", field], ";"]]], "/"]],
  ];
  return [
    "case",
    // 中国台湾：精确匹配各种写法后统一替换（覆盖简体需求）
    ["in", zhName, ["literal", ["台湾", "台灣", "臺灣", "Taiwan"]]],
    "中国台湾",
    ["has", "name:zh-Hans"],
    firstOf("name:zh-Hans"),
    ["has", "name:zh"],
    firstOf("name:zh"),
    ["coalesce", ["get", "name:en"], ["get", "name_int"], ["get", "name"]],
  ] as unknown as string;
}

/**
 * 道路双层（下描边 + 上填充）；casing 省略时只画单层细线。
 * 线宽曲线刻意压窄：z8 约 0.5b、z14 约 1.1b（b=baseWidth），
 * 道路只作地理参照，不能像导航地图一样铺满白线。
 */
function roadLayers(
  id: string,
  cls: string,
  baseWidth: number,
  fill: string,
  casing?: string
): LayerSpecification[] {
  const w = (z: number) => baseWidth * 0.5 + (baseWidth * 0.6 * (z - 8)) / 6;
  const fillLayer: LayerSpecification = {
    id: `${id}-fill`,
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    filter: ["all", ["==", "$type", "LineString"], ["==", "class", cls]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": fill,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, w(8), 14, w(14)],
    },
  };
  if (!casing) return [fillLayer];
  return [
    {
      id: `${id}-case`,
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      filter: ["all", ["==", "$type", "LineString"], ["==", "class", cls]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": casing,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, w(8) + 0.7, 14, w(14) + 1],
      },
    },
    fillLayer,
  ];
}

// ------------------------------------------------------------
// 高德栅格底图（domestic 模式，见上方 BaseMode 说明）
//
// 纯高德源（用户明确不要混合底图）。已知源侧缺口（实测）：
//  - 国外高 zoom（约 z8+）为空白占位图；z4 极地行空白
//   （球面 zoom 3.3~4.2 正好请求 z4，故正南极/正北极会全白）；
//  需要看国外/极地时切「国际」模式。
//
// 选型（实测对比）：style=7 只保留「地标/区级」大字标注，比
// style=8（酒店/商铺全上）干净一个量级；道路密度烘死在图里，
// 靠 paint 压底（去饱和 + 提亮 + 微透明，深 zoom 更狠）。
// 末尾的透明 "place-city" 占位层：engine 会把路线/已行驶层插到它
// 前面（beforeId），保持与矢量样式一致的层序。
// ------------------------------------------------------------
const RASTER_STYLE: StyleSpecification = {
  version: 8,
  name: "Travel Story — Gaode Raster",
  projection: { type: "mercator" as const },
  // 栅格底图没有字形服务，但载具头顶的里程牌（symbol text）需要字形；
  // 复用矢量模式同一个本地字体代理，两种底图下里程牌都能显示
  glyphs: MAP_GLYPHS_URL,
  sources: {
    gaode: {
      type: "raster",
      tiles: [1, 2, 3, 4].map(
        (i) =>
          `https://wprd0${i}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=7&x={x}&y={y}&z={z}`
      ),
      tileSize: 256,
      maxzoom: 18,
      attribution: "© 高德地图 AutoNavi",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#F6F1E4" } },
    {
      id: "gaode",
      type: "raster",
      source: "gaode",
      paint: {
        // 地图是背景：整体压淡、压低饱和，深 zoom（细节最杂）压得更狠
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.9, 14, 0.8],
        "raster-saturation": ["interpolate", ["linear"], ["zoom"], 5, -0.3, 14, -0.68],
        "raster-contrast": -0.1,
        "raster-brightness-min": ["interpolate", ["linear"], ["zoom"], 5, 0.05, 14, 0.16],
      },
    },
    { id: "place-city", type: "background", paint: { "background-opacity": 0 } },
  ],
};
