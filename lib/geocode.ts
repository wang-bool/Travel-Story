// ============================================================
// Travel Story — 地点搜索（Geocoding）
//
// 需求文档 §7：用户搜索地点 → 系统返回候选（标准名称/经纬度/城市/国家/类型）。
//
// v3 定版：双源，两个免费 key，互补国内外：
//   - 高德（place/text）→ 国内 POI 主力，精度高、原生中文、数据新。
//     ⚠️ 实测：Web 服务 API 纯国内（巴黎/埃菲尔铁塔均查无结果）；
//     个别大名单独搜会空（如「布达拉宫」），加城市前缀即中——
//     这类漏网由 LocationIQ 的 OSM 中文名兜底。
//   - LocationIQ（Nominatim 托管版）→ 国外主力，OSM 全球数据 + name:zh 中文名
//     + importance 排名（0–1，基于维基/搜索热度），正是「埃菲尔铁塔→巴黎第一」的解药。
//
// 合并排序：名字匹配 + importance 知名度 + 类型加权 + wikipedia/wikidata 地标信号。
// 国外真身 importance≈0.9 → 大加分，压过国内仿制（深圳世界之窗的埃菲尔铁塔）。
//
// 坐标：高德返回 GCJ-02，国内有加密偏移 → 转 WGS-84（lib/coord.ts）；
// LocationIQ 返回 WGS-84，原样使用。加密只作用于中国境内。
//
// key 只配在服务端 .env.local（GAODE_KEY / LOCATIONIQ_KEY），由
// app/api/geocode/route.ts 代理，前端不接触 key。未配置时返回空，
// route 告诉前端「未配置」，界面给出提示而不是假装没搜到。
// ============================================================

import { gcj02ToWgs84 } from "./coord";
import type { SearchResult, StopType } from "./types";

const GAODE_ENDPOINT = "https://restapi.amap.com/v3/place/text";
// 实测：eu1 从国内访问最快（~1s），us1 通但慢（~2.3s），ap1 连不上。
// 故 eu1 优先、us1 兜底。
const LOCATIONIQ_ENDPOINTS = ["https://eu1.locationiq.com/v1/search", "https://us1.locationiq.com/v1/search"];

function getConfig() {
  return {
    gaodeKey: process.env.GAODE_KEY?.trim() || "",
    locationiqKey: process.env.LOCATIONIQ_KEY?.trim() || "",
  };
}

/** 是否已配置至少一个搜索 key（route 用它判断要不要提示用户） */
export function hasSearchKeys(): boolean {
  const cfg = getConfig();
  return Boolean(cfg.gaodeKey || cfg.locationiqKey);
}

// ------------------------------------------------------------
// 缓存（服务端内存；命中免去重复请求、保护免费配额）
// ------------------------------------------------------------

const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { t: number; results: SearchResult[] }>();

function cacheGet(q: string): SearchResult[] | undefined {
  const hit = cache.get(q);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.results;
  if (hit) cache.delete(q);
  return undefined;
}

function cacheSet(q: string, results: SearchResult[]) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(q, { t: Date.now(), results });
}

// ------------------------------------------------------------
// 入口（服务端调用）
// ------------------------------------------------------------

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const cfg = getConfig();
  const providers: Array<() => Promise<Candidate[]>> = [];
  if (cfg.gaodeKey) providers.push(() => gaodeSearch(q, cfg.gaodeKey, signal));
  if (cfg.locationiqKey) providers.push(() => locationiqSearch(q, cfg.locationiqKey, signal));
  if (providers.length === 0) return [];

  const cached = cacheGet(q);
  if (cached) return cached;

  const settled = await Promise.allSettled(providers.map((p) => withTimeout(p(), 5000)));
  const lists = settled
    .filter((r): r is PromiseFulfilledResult<Candidate[]> => r.status === "fulfilled")
    .map((r) => r.value);

  const results = mergeResults(q, lists).slice(0, 8);
  cacheSet(q, results);
  return results;
}

/** 给请求套超时，避免服务宕机时一直挂起 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

// ------------------------------------------------------------
// 合并 / 去重 / 多信号排序
// ------------------------------------------------------------

type ProviderName = "gaode" | "locationiq";

interface Candidate extends SearchResult {
  source: ProviderName;
  /** 知名度 0–1（LocationIQ importance），越高越知名 */
  importance?: number;
  /** 有 wikipedia/wikidata 等硬地标信号 */
  isLandmark?: boolean;
  /** 插入顺序，用于同分稳定排序（mergeResults 阶段赋值） */
  order?: number;
}

/** 对各家自身排序的信任度（越低越可信，作为基础分） */
const PROVIDER_BASE: Record<ProviderName, number> = {
  gaode: -5, // 国内 POI 质量更高，给一点优先
  locationiq: 0,
};

/** 高知名度的地标类（名字命中时加分） */
const LANDMARK_TYPES: ReadonlySet<StopType> = new Set([
  "tower",
  "skyscraper",
  "skyline",
  "museum",
  "beach",
  "mountain",
  "temple",
  "bridge",
  "lake",
  "river",
  "sea",
  "scenic",
  "attraction",
]);

function score(r: Candidate, q: string): number {
  let w = PROVIDER_BASE[r.source];
  const n = r.name.toLowerCase();
  const qq = q.toLowerCase();

  // 城市/行政地名：全球同名太多（伦敦有英国/加拿大/美国…），
  // 以知名度 importance 为主，名字匹配弱化——搜「伦敦」应得英国伦敦。
  if (r.type === "city") {
    if (n === qq) w -= 40;
    else if (n.startsWith(qq)) w -= 25;
    else if (n.includes(qq)) w -= 15;
    if (r.importance != null) w -= r.importance * 120;
    if (r.isLandmark) w -= 60;
    w -= 10;
    return w;
  }

  // POI/景点：精确匹配优先（「埃菲尔铁塔」精确=巴黎真身，深圳只是含匹配），
  // 知名度次之。
  if (n === qq) w -= 110;
  else if (n.startsWith(qq)) w -= 60;
  else if (n.includes(qq)) w -= 25;
  if (r.importance != null) w -= r.importance * 45;
  if (r.isLandmark) w -= 45;
  // 类型：地标类优先；餐厅/酒店这类「常被山寨命名」的降权
  if (LANDMARK_TYPES.has(r.type)) w -= 6;
  else if (r.type === "restaurant" || r.type === "hotel" || r.type === "other") w += 8;
  return w;
}

function mergeResults(q: string, lists: Candidate[][]): SearchResult[] {
  let order = 0;
  const candidates: Candidate[] = [];

  for (const list of lists) {
    for (const r of list) {
      candidates.push({ ...r, order: order++ });
    }
  }

  // 打分后排序；同分按插入顺序稳定排序（各家自己的返回顺序尽量保留）
  const scored = candidates
    .map((c) => ({ c, w: score(c, q) }))
    .sort((a, b) => a.w - b.w || (a.c.order ?? 0) - (b.c.order ?? 0));

  // 去重：同名且相距 <800m 视为同一地（保留分数最优者）。
  // 用距离而非 toFixed 舍入，避免两个真同地点落在舍入边界两侧被当成不同。
  const out: SearchResult[] = [];
  for (const { c } of scored) {
    if (out.some((x) => nearSameName(x, c))) continue;
    out.push({
      id: c.id,
      name: c.name,
      displayName: c.displayName,
      latitude: c.latitude,
      longitude: c.longitude,
      type: c.type,
      city: c.city,
      country: c.country,
    });
  }
  return out;
}

/** 同名且距离 <800m（近似度，旅行规划足够） */
function nearSameName(a: SearchResult, b: SearchResult): boolean {
  if (a.name.toLowerCase() !== b.name.toLowerCase()) return false;
  const dLat = (a.latitude - b.latitude) * 111320;
  const dLon = (a.longitude - b.longitude) * 111320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(dLat, dLon) < 800;
}

// ------------------------------------------------------------
// 高德（place/text 文本搜索）—— 国内主力
// ------------------------------------------------------------

interface GaodePoi {
  id?: string;
  name?: string;
  // ⚠️ 高德把空字段返回成 [] 而不是 ""，用前必须 typeof 判断
  location?: string | unknown[]; // "lng,lat"（GCJ-02）
  type?: string;
  pname?: string | unknown[];    // 省
  cityname?: string | unknown[]; // 市
  adname?: string | unknown[];   // 区/县
}

interface GaodeResponse {
  status: string; // "1" 成功
  info?: string;
  pois?: GaodePoi[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

async function gaodeSearch(q: string, key: string, signal?: AbortSignal): Promise<Candidate[]> {
  const url = new URL(GAODE_ENDPOINT);
  url.searchParams.set("key", key);
  url.searchParams.set("keywords", q); // 不给 city 参数 = 全国范围
  url.searchParams.set("output", "json");
  url.searchParams.set("offset", "10");
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`gaode ${res.status}`);
  const data = (await res.json()) as GaodeResponse;
  if (data.status !== "1") throw new Error(`gaode ${data.info ?? "error"}`);
  return (data.pois ?? [])
    .filter((p) => p.name && str(p.location)?.includes(","))
    .map((p) => {
      const [lng, lat] = str(p.location)!.split(",").map(Number);
      const wgs = gcj02ToWgs84(lat, lng); // 火星坐标 → OSM 底图坐标
      const city = str(p.cityname);
      return {
        id: `gd_${p.id ?? `${p.name}_${lat.toFixed(4)}_${lng.toFixed(4)}`}`,
        name: p.name!,
        displayName: [p.name, str(p.adname), city, str(p.pname)].filter(Boolean).join("，"),
        latitude: wgs.lat,
        longitude: wgs.lon,
        type: gaodeToStopType(str(p.type) ?? ""),
        city,
        // 高德 Web 服务纯国内，country 不猜
        country: undefined,
        source: "gaode",
      };
    });
}

/** 高德 type 形如「风景名胜;风景名胜;国家级景点」，按关键词归并 */
function gaodeToStopType(t: string): StopType {
  if (t.includes("机场")) return "airport";
  if (t.includes("火车站") || t.includes("地铁") || t.includes("港口")) return "station";
  if (t.includes("博物馆") || t.includes("展览馆")) return "museum";
  if (t.includes("动物园")) return "zoo";
  if (t.includes("公园")) return "park";
  if (t.includes("海滩") || t.includes("海滨")) return "beach";
  if (t.includes("湖泊") || t.includes("水库")) return "lake";
  if (t.includes("寺庙") || t.includes("教堂") || t.includes("道观")) return "temple";
  if (t.includes("桥")) return "bridge";
  if (t.includes("宾馆") || t.includes("酒店") || t.includes("住宿")) return "hotel";
  if (t.includes("餐饮") || t.includes("餐厅") || t.includes("美食")) return "restaurant";
  if (t.includes("风景名胜") || t.includes("自然")) return "scenic";
  if (t.includes("塔") || t.includes("观光")) return "tower";
  return "attraction";
}

// ------------------------------------------------------------
// LocationIQ（Nominatim 托管版）—— 国外主力
// ------------------------------------------------------------

interface LocationIqHit {
  place_id: number;
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
  class?: string;
  type?: string;
  importance?: number;
  namedetails?: Record<string, string>;
  extratags?: { wikipedia?: string; wikidata?: string; historic?: string };
  address?: {
    city?: string;
    town?: string;
    village?: string;
    country?: string;
    state?: string;
  };
}

/** 从 OSM 多写法里挑简体名：name:zh-Hans > name:zh(取第一写法) > name:zh-Hant > name */
function zhName(h: LocationIqHit): string {
  const nd = h.namedetails ?? {};
  const zhHans = nd["name:zh-Hans"]?.trim();
  if (zhHans) return zhHans.split(/[;；/]/)[0].trim();
  const zh = nd["name:zh"] ?? h.name;
  if (zh) return zh.split(/[;；/]/)[0].trim();
  return h.display_name.split(",")[0].trim();
}

async function locationiqSearch(q: string, key: string, signal?: AbortSignal): Promise<Candidate[]> {
  // eu1 优先；失败（网络/超时/服务端错误）则退到 us1
  let lastErr: unknown;
  for (const endpoint of LOCATIONIQ_ENDPOINTS) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("key", key);
      url.searchParams.set("q", q);
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "8");
      url.searchParams.set("extratags", "1");
      url.searchParams.set("namedetails", "1");
      url.searchParams.set("accept-language", "zh-CN,en");
      const res = await fetch(url.toString(), { signal });
      if (!res.ok) throw new Error(`locationiq ${res.status}`);
      const hits = (await res.json()) as LocationIqHit[] | { error?: { code: number; message: string } };
      if (!Array.isArray(hits)) throw new Error("locationiq error");
      return hits
        .filter((h) => h.lat && h.lon)
        .map((h) => ({
          id: `liq_${h.place_id}`,
          name: zhName(h),
          displayName: h.display_name,
          latitude: Number(h.lat),
          longitude: Number(h.lon),
          type: osmToStopType(h),
          city: h.address?.city || h.address?.town || h.address?.village,
          country: h.address?.country,
          importance: h.importance,
          isLandmark: Boolean(h.extratags?.wikipedia || h.extratags?.wikidata || h.extratags?.historic),
          source: "locationiq",
        }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("locationiq unreachable");
}

/** OSM class/type → StopType（LocationIQ 复用） */
function osmToStopType(h: LocationIqHit): StopType {
  const cls = h.class ?? "";
  const type = h.type ?? "";
  if (h.name?.includes("动物园")) return "zoo";
  if (cls === "tourism") {
    if (type === "hotel" || type === "hostel") return "hotel";
    if (type === "museum" || type === "gallery") return "museum";
    if (type === "zoo") return "zoo";
    if (type === "aquarium") return "sea";
    return "attraction";
  }
  if (cls === "historic") return "attraction";
  if (cls === "leisure" && type === "park") return "park";
  if (cls === "leisure" && type === "garden") return "garden";
  if (cls === "aeroway") return "airport";
  if (cls === "railway" && (type === "station" || type === "halt")) return "station";
  if (cls === "natural" && (type === "water" || type === "lake")) return "lake";
  if (cls === "natural" && (type === "wood" || type === "forest")) return "forest";
  if (cls === "natural" && (type === "beach" || type === "sand")) return "beach";
  if (cls === "natural" && (type === "bay" || type === "sea" || type === "coastline")) return "sea";
  if (cls === "natural" && (type === "peak" || type === "volcano")) return "mountain";
  if (cls === "waterway") return "river";
  if (cls === "man_made" && (type === "tower" || type === "lighthouse")) return "tower";
  if (cls === "man_made" && type === "bridge") return "bridge";
  if (cls === "amenity" && type === "place_of_worship") return "temple";
  if (cls === "amenity" && (type === "restaurant" || type === "cafe" || type === "bar")) return "restaurant";
  if (cls === "boundary" || cls === "administrative" || cls === "place") return "city";
  if (cls === "building") return "attraction";
  return "other";
}

// ------------------------------------------------------------
// 逆地理（坐标 → 城市/国家）：给早期缺 city/country 的地点回填，
// 足迹统计（几个国家/几个城市）才有可靠数据源。
//   - LocationIQ reverse：city + country 都有、全球覆盖，优先；
//   - 高德 regeo：国内兜底（city 有；country 按国内语义给「中国」）。
// ------------------------------------------------------------

export interface ReverseResult {
  city?: string;
  country?: string;
}

export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<ReverseResult | null> {
  const cfg = getConfig();
  if (cfg.locationiqKey) {
    try {
      const r = await withTimeout(liqReverse(lat, lng, cfg.locationiqKey, signal), 5000);
      if (r) return r;
    } catch {
      /* 掉高德兜底 */
    }
  }
  if (cfg.gaodeKey) {
    try {
      const r = await withTimeout(gaodeReverse(lat, lng, cfg.gaodeKey, signal), 5000);
      if (r) return r;
    } catch {
      /* 无结果 */
    }
  }
  return null;
}

/** LocationIQ /v1/reverse：与 search 同一组端点，eu1 优先、us1 兜底 */
async function liqReverse(
  lat: number,
  lng: number,
  key: string,
  signal?: AbortSignal
): Promise<ReverseResult | null> {
  let lastErr: unknown;
  for (const endpoint of LOCATIONIQ_ENDPOINTS) {
    try {
      const url = new URL(endpoint.replace(/\/search$/, "/reverse"));
      url.searchParams.set("key", key);
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lng));
      url.searchParams.set("format", "json");
      url.searchParams.set("accept-language", "zh-CN,en");
      const res = await fetch(url.toString(), { signal });
      if (!res.ok) throw new Error(`locationiq reverse ${res.status}`);
      const data = (await res.json()) as {
        address?: {
          city?: string;
          town?: string;
          village?: string;
          county?: string;
          state?: string;
          country?: string;
        };
      };
      const a = data.address;
      if (!a) return null;
      // 城市粒度按统计口径取：直辖市的「市」在 state（上海市），
      // 不能落到 village/county（曹家渡/严桥这种街道级会虚增城市数）
      const city = a.city || a.town || a.state || a.village || a.county;
      // OSM 多写法会返回「德国;德國」这种串，取第一写法
      const clean = (v?: string) => v?.split(/[;；]/)[0].trim() || undefined;
      if (!city && !a.country) return null;
      return { city: clean(city), country: clean(a.country) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("locationiq reverse unreachable");
}

/** 高德 regeo：国内兜底。addressComponent 空字段同样是 [] 不是 "" */
async function gaodeReverse(
  lat: number,
  lng: number,
  key: string,
  signal?: AbortSignal
): Promise<ReverseResult | null> {
  const url = new URL("https://restapi.amap.com/v3/geocode/regeo");
  url.searchParams.set("key", key);
  url.searchParams.set("location", `${lng},${lat}`);
  url.searchParams.set("output", "json");
  url.searchParams.set("extensions", "base");
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`gaode regeo ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    regeocode?: {
      addressComponent?: {
        province?: string | unknown[];
        city?: string | unknown[];
        district?: string | unknown[];
      };
    };
  };
  if (data.status !== "1") throw new Error("gaode regeo error");
  const ac = data.regeocode?.addressComponent;
  if (!ac) return null;
  const province = str(ac.province);
  // 直辖市 city 是 [] → 用省；普通城市用 city；再不行用区
  const city = str(ac.city) ?? province ?? str(ac.district);
  if (!city && !province) return null; // 境外：高德给不出有效行政区
  return { city, country: "中国" };
}
