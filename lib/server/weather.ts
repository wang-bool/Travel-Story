// 逐日天气预报：Open-Meteo（免费、无需 key，CC BY 4.0），全球覆盖含中国大陆。
// 输出 label/low/high/effect 可直接喂给 edit_itinerary 的 set_weather。
// 预报不替代官方灾害预警——预警仍需模型用网页来源核验（见 skill references/weather.md）。
import { TravelError, date, shiftDate } from '../domain/itinerary.ts';
import { searchPlaces } from '../geocode.ts';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const MAX_FORECAST_DAYS = 16; // Open-Meteo 预报上限（含当天）
const MAX_PAST_DAYS = 7; // 允许回看近几天，更久的没有旅行意义
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_MAX = 100;
const cache = new Map<string, { t: number; result: Record<string, unknown> }>();

// WMO weather code → [中文 label, 地图特效 effect]
// 降水按强度细分特效：毛毛雨(drizzle)/雨(rain)/大雨(heavy-rain)、雪(snow)/大雪(heavy-snow)；
// 雾独立成 fog（不再借 overcast）；无雨雪时按风力叠加 breeze/wind。
const WMO: Record<number, [string, string]> = {
    0: ['晴', 'sun'], 1: ['晴间多云', 'sun'], 2: ['多云', 'cloud'], 3: ['阴', 'overcast'],
    45: ['雾', 'fog'], 48: ['雾凇', 'fog'],
    51: ['毛毛雨', 'drizzle'], 53: ['毛毛雨', 'drizzle'], 55: ['浓毛毛雨', 'drizzle'], 56: ['冻毛毛雨', 'drizzle'], 57: ['冻毛毛雨', 'drizzle'],
    61: ['小雨', 'rain'], 63: ['中雨', 'rain'], 65: ['大雨', 'heavy-rain'], 66: ['冻雨', 'rain'], 67: ['强冻雨', 'heavy-rain'],
    71: ['小雪', 'snow'], 73: ['中雪', 'snow'], 75: ['大雪', 'heavy-snow'], 77: ['雪粒', 'snow'],
    80: ['阵雨', 'rain'], 81: ['强阵雨', 'heavy-rain'], 82: ['暴雨', 'heavy-rain'], 85: ['阵雪', 'snow'], 86: ['强阵雪', 'heavy-snow'],
    95: ['雷阵雨', 'storm'], 96: ['雷阵雨伴冰雹', 'storm'], 99: ['强雷暴伴冰雹', 'storm'],
};
const BREEZE_KPH = 39; // 6 级风：无雨雪时以 breeze 特效展示
const GALE_KPH = 62; // 8 级风：无雨雪时以 wind 特效展示

export interface WeatherInput {
    latitude?: number;
    longitude?: number;
    city?: string;
    startDate: string;
    endDate: string;
}

async function resolveLocation(input: WeatherInput) {
    if (Number.isFinite(input.latitude) && Number.isFinite(input.longitude)) {
        return { latitude: input.latitude!, longitude: input.longitude! };
    }
    const city = String(input.city ?? '').trim();
    if (!city) throw new TravelError('INVALID_INPUT', 'Provide latitude+longitude or city');
    const candidates = await searchPlaces(city).catch(() => []);
    const hit = candidates.find(c => c.type === 'city') ?? candidates[0];
    if (!hit) throw new TravelError('WEATHER_LOCATION_NOT_FOUND', `Could not resolve "${city}" to coordinates; pass latitude/longitude from search_places instead`);
    return { latitude: hit.latitude, longitude: hit.longitude, resolvedName: hit.name, resolvedDisplayName: hit.displayName };
}

export async function getForecast(input: WeatherInput) {
    const location = await resolveLocation(input);
    const start = date(input.startDate), end = date(input.endDate);
    if (start > end) throw new TravelError('INVALID_INPUT', 'startDate must be on or before endDate');
    if ((Date.parse(end) - Date.parse(start)) / 86400000 + 1 > MAX_FORECAST_DAYS) throw new TravelError('INVALID_INPUT', `Date range too long (max ${MAX_FORECAST_DAYS} days per call)`);
    // 预报窗口：过去 7 天 ~ 未来 16 天（按 UTC 今天近似，时区差异由返回的 timezone 兜底说明）
    const todayUtc = new Date().toISOString().slice(0, 10);
    const minStart = shiftDate(todayUtc, -MAX_PAST_DAYS), maxEnd = shiftDate(todayUtc, MAX_FORECAST_DAYS - 1);
    if (start > maxEnd) throw new TravelError('OUT_OF_FORECAST_RANGE', `${start} 超出 ${MAX_FORECAST_DAYS} 天预报范围（当前最远约到 ${maxEnd}）；尚无可核验的逐日预报，请在临近出行时再查或用网页来源说明缺口`);
    const clampedStart = start < minStart ? minStart : start;
    const clampedEnd = end > maxEnd ? maxEnd : end;
    const truncated = clampedStart !== start || clampedEnd !== end;

    const cacheKey = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}:${clampedStart}:${clampedEnd}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.t < CACHE_TTL) return { ...structuredClone(hit.result), cached: true };

    const url = new URL(ENDPOINT);
    url.searchParams.set('latitude', location.latitude.toFixed(4));
    url.searchParams.set('longitude', location.longitude.toFixed(4));
    url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('start_date', clampedStart);
    url.searchParams.set('end_date', clampedEnd);
    let data: any;
    try {
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
        data = await res.json().catch(() => undefined);
        if (!res.ok) throw new TravelError('WEATHER_FAILED', typeof data?.reason === 'string' ? `Open-Meteo: ${data.reason.slice(0, 200)}` : `Open-Meteo HTTP ${res.status}`);
    } catch (e) {
        if (e instanceof TravelError) throw e;
        throw new TravelError('WEATHER_FAILED', 'Weather service unavailable; fall back to web sources and say so');
    }
    const daily = data?.daily;
    if (!daily || !Array.isArray(daily.time) || !daily.time.length) throw new TravelError('WEATHER_FAILED', 'Weather service returned no daily forecast');

    const days = daily.time.map((d: string, i: number) => {
        const code = daily.weather_code?.[i];
        const [label, baseEffect] = WMO[code] ?? ['未知', 'cloud'];
        const wind = daily.wind_speed_10m_max?.[i];
        const effect = wind != null && ['sun', 'cloud', 'overcast'].includes(baseEffect)
            ? wind >= GALE_KPH ? 'wind' : wind >= BREEZE_KPH ? 'breeze' : baseEffect
            : baseEffect;
        const low = daily.temperature_2m_min?.[i], high = daily.temperature_2m_max?.[i];
        return {
            date: d, label, effect,
            ...(typeof low === 'number' ? { low: Math.round(low) } : {}),
            ...(typeof high === 'number' ? { high: Math.round(high) } : {}),
            ...(typeof daily.precipitation_sum?.[i] === 'number' ? { precipitationMm: daily.precipitation_sum[i] } : {}),
            ...(typeof daily.precipitation_probability_max?.[i] === 'number' ? { precipitationProbability: daily.precipitation_probability_max[i] } : {}),
            ...(typeof wind === 'number' ? { windMaxKph: wind } : {}),
            weatherCode: code ?? null,
        };
    });
    const result: Record<string, unknown> = {
        location,
        timezone: typeof data.timezone === 'string' ? data.timezone : undefined,
        days,
        ...(truncated ? { note: `请求的日期超出可预报范围，已截断为 ${clampedStart} ~ ${clampedEnd}（预报窗口约为近 ${MAX_PAST_DAYS} 天到未来 ${MAX_FORECAST_DAYS} 天）` } : {}),
        source: 'open-meteo',
        attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
        usage: 'days[].label/low/high/effect 可直接用于 edit_itinerary 的 set_weather；官方灾害预警需另行用网页来源核验',
        cached: false,
    };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { t: Date.now(), result });
    return structuredClone(result);
}
