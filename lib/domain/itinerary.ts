import type { Trip, TripStop, TripSegment, Transport, DayWeather } from '../types.ts';
export class TravelError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
}
export function check(value: unknown, code: string, message: string): asserts value {
    if (!value)
        throw new TravelError(code, message);
}
export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export function text(value: unknown, label: string, max = 2000): string {
    check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_INPUT', `${label} must be a nonempty string (max ${max})`);
    return value.trim();
}
export function date(value: unknown): string {
    const s = text(value, 'date', 10);
    check(/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, 'INVALID_INPUT', 'Use a valid YYYY-MM-DD date');
    return s;
}
export const shiftDate = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export function dayCount(start: string, end: string) {
    const n = (Date.parse(date(end)) - Date.parse(date(start))) / 86400000 + 1;
    check(Number.isInteger(n) && n > 0 && n <= 366, 'INVALID_INPUT', 'Trip must have between 1 and 366 days');
    return n;
}
const transports = new Set(['car', 'bus', 'train', 'subway', 'plane', 'ship', 'kayak', 'motorcycle', 'bicycle', 'scooter', 'walk', 'horse', 'ufo', 'swim', 'rocket']);
const stopTypes = new Set(['attraction', 'museum', 'park', 'zoo', 'hotel', 'airport', 'station', 'beach', 'lake', 'mountain', 'restaurant', 'scenic', 'city', 'tower', 'skyscraper', 'skyline', 'garden', 'forest', 'river', 'sea', 'temple', 'bridge', 'other']);
const weatherEffects = new Set(['sun', 'cloud', 'overcast', 'fog', 'drizzle', 'rain', 'heavy-rain', 'snow', 'heavy-snow', 'breeze', 'wind', 'storm']);
// 天气对象：label 必填（展示文本），low/high 气温（摄氏度）可选，effect 供地图特效
export function weather(input: unknown): DayWeather {
    check(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_INPUT', 'Invalid weather');
    const w = input as Record<string, unknown>;
    const out: DayWeather = { label: text(w.label, 'weather label', 100) };
    for (const k of ['low', 'high'] as const)
        if (w[k] !== undefined) {
            check(typeof w[k] === 'number' && Number.isFinite(w[k]) && Math.abs(w[k] as number) < 100, 'INVALID_INPUT', 'Invalid temperature');
            out[k] = w[k] as number;
        }
    if (w.effect !== undefined) {
        check(typeof w.effect === 'string' && weatherEffects.has(w.effect), 'INVALID_INPUT', 'Invalid weather effect');
        out.effect = w.effect as DayWeather['effect'];
    }
    return out;
}
export function transport(value: unknown): Transport { check(typeof value === 'string' && transports.has(value), 'INVALID_INPUT', 'Unknown transport'); return value as Transport; }
export function place(input: unknown): Omit<TripStop, 'id' | 'dayId' | 'day' | 'order'> {
    check(input && typeof input === 'object', 'INVALID_INPUT', 'Invalid place');
    const p = input as Record<string, unknown>;
    check(typeof p.latitude === 'number' && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && typeof p.longitude === 'number' && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180, 'INVALID_INPUT', 'Invalid coordinates');
    check(typeof p.type === 'string' && stopTypes.has(p.type), 'INVALID_INPUT', 'Invalid place type');
    return { name: text(p.name, 'place name', 300), latitude: p.latitude, longitude: p.longitude, type: p.type as TripStop['type'], ...(typeof p.city === 'string' ? { city: p.city } : {}), ...(typeof p.country === 'string' ? { country: p.country } : {}) };
}
export function normalize(trip: Trip): Trip {
    trip.days.forEach((d, i) => { d.day = i + 1; d.date = shiftDate(trip.startDate, i); });
    trip.endDate = trip.days.at(-1)!.date;
    const dayOrder = new Map(trip.days.map((d, i) => [d.id, i]));
    check(trip.stops.every(s => dayOrder.has(s.dayId)), 'INVALID_INPUT', 'Stop references missing day');
    trip.stops.sort((a, b) => dayOrder.get(a.dayId)! - dayOrder.get(b.dayId)! || a.order - b.order);
    trip.stops.forEach((s, i) => { s.day = dayOrder.get(s.dayId)! + 1; s.order = i; });
    const old = new Map(trip.segments.map(s => [`${s.fromStopId}:${s.toStopId}`, s]));
    trip.segments = trip.stops.slice(0, -1).map((from, i) => {
        const to = trip.stops[i + 1], cached = old.get(`${from.id}:${to.id}`);
        return cached ? { ...cached } : { id: uid('seg'), fromStopId: from.id, toStopId: to.id, transport: 'car', route: null };
    });
    return trip;
}
export function makeTrip(input: Record<string, unknown>): Trip {
    const start = date(input.startDate), end = date(input.endDate), n = dayCount(start, end);
    return normalize({ id: uid('trip'), name: text(input.name, 'name', 200), startDate: start, endDate: end, origin: typeof input.origin === 'string' ? input.origin : undefined, region: typeof input.region === 'string' ? input.region : undefined, description: typeof input.description === 'string' ? input.description : undefined, isPublic: false, coverHue: 20, createdAt: Date.now(), revision: 1, days: Array.from({ length: n }, (_, i) => ({ id: uid('day'), day: i + 1, date: shiftDate(start, i) })), stops: [], segments: [] });
}
export function patchTrip(trip: Trip, patch: Record<string, unknown>) {
    check(patch && typeof patch === 'object' && !Array.isArray(patch), 'INVALID_INPUT', 'Invalid patch');
    const allowed = ['name', 'origin', 'region', 'description', 'startDate', 'endDate', 'isPublic'];
    check(Object.keys(patch).every(k => allowed.includes(k)), 'INVALID_INPUT', 'Unsupported trip field');
    if (patch.name !== undefined)
        trip.name = text(patch.name, 'name', 200);
    for (const k of ['origin', 'region', 'description'] as const)
        if (patch[k] !== undefined) {
            check(typeof patch[k] === 'string' && (patch[k] as string).length <= 5000, 'INVALID_INPUT', `Invalid ${k}`);
            trip[k] = patch[k] as string;
        }
    if (patch.isPublic !== undefined) {
        check(typeof patch.isPublic === 'boolean', 'INVALID_INPUT', 'Invalid isPublic');
        trip.isPublic = patch.isPublic;
    }
    const start = patch.startDate === undefined ? trip.startDate : date(patch.startDate);
    const end = patch.endDate === undefined ? shiftDate(start, trip.days.length - 1) : date(patch.endDate);
    const n = dayCount(start, end);
    const removed = new Set(trip.days.slice(n).map(d => d.id));
    check(!trip.stops.some(s => removed.has(s.dayId)), 'DATE_CONFLICT', 'Shorter dates would remove occupied days; move or remove their stops first');
    trip.startDate = start;
    trip.days = trip.days.slice(0, n);
    while (trip.days.length < n)
        trip.days.push({ id: uid('day'), day: trip.days.length + 1, date: start });
    normalize(trip);
}
export type Operation = Record<string, any>;
export function applyOperations(trip: Trip, operations: Operation[], web = false) {
    check(Array.isArray(operations) && operations.length > 0 && operations.length <= 100, 'INVALID_INPUT', 'Provide 1-100 operations');
    const refs = new Map<string, string>();
    const resolve = (id: unknown) => typeof id === 'string' ? (refs.get(id) ?? id) : '';
    const findDay = (id: unknown) => { const d = trip.days.find(d => d.id === resolve(id)); check(d, 'DAY_NOT_FOUND', 'Day not found'); return d; };
    const findStop = (id: unknown) => { const s = trip.stops.find(s => s.id === resolve(id)); check(s, 'STOP_NOT_FOUND', 'Stop not found'); return s; };
    const position = (value: unknown, max: number) => { const n = value === undefined ? max : value; check(Number.isInteger(n) && Number(n) >= 0 && Number(n) <= max, 'INVALID_INPUT', 'Invalid insertion position'); return Number(n); };
    const insert = (s: TripStop, dayId: string, p: unknown) => { const others = trip.stops.filter(x => x.id !== s.id && x.dayId === dayId); others.splice(position(p, others.length), 0, s); s.dayId = dayId; others.forEach((x, i) => x.order = i); };
    const before = new Map(trip.segments.filter(s => s.route).map(s => [s.id, JSON.stringify(s.route)]));
    const results: Record<string, unknown>[] = [];
    for (const op of operations) {
        check(op && typeof op === 'object', 'INVALID_INPUT', 'Invalid operation');
        const r: Record<string, unknown> = { op: op.op };
        switch (op.op) {
            case 'add_day': {
                check(trip.days.length < 366, 'INVALID_INPUT', 'Too many days');
                const d = { id: uid('day'), day: 0, date: trip.startDate };
                trip.days.splice(position(op.position, trip.days.length), 0, d);
                r.dayId = d.id;
                break;
            }
            case 'remove_day': {
                const d = findDay(op.dayId);
                check(trip.days.length > 1, 'INVALID_INPUT', 'Keep at least one day');
                const occupied = trip.stops.filter(s => s.dayId === d.id);
                if (occupied.length) {
                    check(op.stopHandling === 'delete' || op.stopHandling === 'move', 'DAY_NOT_EMPTY', 'Choose delete or move for occupied day');
                    if (op.stopHandling === 'move') {
                        const target = findDay(op.targetDayId);
                        check(target.id !== d.id, 'INVALID_INPUT', 'Choose another day');
                        for (const s of occupied)
                            insert(s, target.id, undefined);
                    }
                    else
                        trip.stops = trip.stops.filter(s => s.dayId !== d.id);
                }
                trip.days = trip.days.filter(x => x.id !== d.id);
                r.dayId = d.id;
                break;
            }
            case 'add_stop': {
                const d = findDay(op.dayId);
                check(web || !op.place, 'INVALID_INPUT', 'MCP must use candidateId');
                const p = place(op.place);
                const s: TripStop = { ...p, id: uid('stop'), dayId: d.id, day: d.day, order: 0 };
                insert(s, d.id, op.position);
                trip.stops.push(s);
                r.stopId = s.id;
                r.dayId = d.id;
                if (op.clientRef !== undefined) {
                    const ref = text(op.clientRef, 'clientRef', 100);
                    check(!refs.has(ref), 'INVALID_INPUT', 'Duplicate clientRef');
                    refs.set(ref, s.id);
                    r.clientRef = ref;
                }
                break;
            }
            case 'update_stop': {
                const s = findStop(op.stopId);
                const patch = op.patch ?? {};
                check(Object.keys(patch).every(k => ['name', 'city', 'country'].includes(k)), 'INVALID_INPUT', 'Unsupported stop field');
                for (const k of Object.keys(patch)) {
                    check(typeof patch[k] === 'string' && patch[k].length <= 500, 'INVALID_INPUT', 'Invalid stop metadata');
                    (s as unknown as Record<string, unknown>)[k] = k === 'name' ? text(patch[k], 'place name', 300) : patch[k];
                }
                if (op.place) {
                    check(web, 'INVALID_INPUT', 'MCP must use candidateId');
                    Object.assign(s, place(op.place));
                    trip.segments.forEach(seg => { if (seg.fromStopId === s.id || seg.toStopId === s.id) {
                        seg.route = null;
                        seg.distance = undefined;
                        seg.duration = undefined;
                        seg.routeInfo = undefined;
                    } });
                }
                r.stopId = s.id;
                break;
            }
            case 'remove_stop': {
                const s = findStop(op.stopId);
                trip.stops = trip.stops.filter(x => x.id !== s.id);
                r.stopId = s.id;
                break;
            }
            case 'move_stop': {
                const s = findStop(op.stopId), d = findDay(op.targetDayId ?? s.dayId);
                insert(s, d.id, op.position);
                r.stopId = s.id;
                break;
            }
            case 'set_transport': {
                const from = findStop(op.fromStopId), to = findStop(op.toStopId);
                const seg = trip.segments.find(s => s.fromStopId === from.id && s.toStopId === to.id);
                check(seg, 'SEGMENT_NOT_FOUND', 'Stops must be adjacent');
                seg.transport = transport(op.transport);
                seg.route = null;
                seg.distance = undefined;
                seg.duration = undefined;
                seg.routeInfo = undefined;
                r.segmentId = seg.id;
                break;
            }
            case 'set_weather': {
                const d = findDay(op.dayId);
                d.weather = op.weather === null ? undefined : weather(op.weather);
                r.dayId = d.id;
                break;
            }
            case 'add_media': {
                check(web, 'INVALID_INPUT', 'Internal web operation');
                const s = findStop(op.stopId), m = op.media;
                check(m && typeof m.id === 'string' && /^media_[\w-]+$/.test(m.id) && ['image', 'video'].includes(m.kind) && typeof m.name === 'string' && Number.isFinite(m.createdAt), 'INVALID_INPUT', 'Invalid media');
                s.media = [...(s.media ?? []).filter(x => x.id !== m.id), m];
                r.stopId = s.id;
                break;
            }
            case 'remove_media': {
                check(web, 'INVALID_INPUT', 'Internal web operation');
                const s = findStop(op.stopId);
                s.media = (s.media ?? []).filter(m => m.id !== op.mediaId);
                r.stopId = s.id;
                break;
            }
            case 'set_route': {
                check(web, 'INVALID_INPUT', 'Internal route operation');
                const seg = trip.segments.find(s => s.id === op.segmentId && s.fromStopId === op.fromStopId && s.toStopId === op.toStopId && s.transport === op.transport);
                check(seg, 'REVISION_CONFLICT', 'Route endpoints changed');
                const route = op.route;
                check(route === null || (route?.type === 'LineString' && Array.isArray(route.coordinates) && route.coordinates.length >= 2 && route.coordinates.length <= 100000 && route.coordinates.every((c: unknown) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90)), 'INVALID_INPUT', 'Invalid route geometry');
                seg.route = route;
                seg.distance = typeof op.distance === 'number' && Number.isFinite(op.distance) && op.distance >= 0 ? op.distance : undefined;
                seg.duration = typeof op.duration === 'number' && Number.isFinite(op.duration) && op.duration >= 0 ? op.duration : undefined;
                seg.routeInfo = op.routeInfo;
                r.segmentId = seg.id;
                break;
            }
            default: throw new TravelError('INVALID_INPUT', `Unknown operation ${op.op}`);
        }
        normalize(trip);
        results.push(r);
    }
    const invalidatedSegmentIds = [...before].filter(([id, geometry]) => !trip.segments.some(s => s.id === id && JSON.stringify(s.route) === geometry)).map(([id]) => id);
    return { results, invalidatedSegmentIds };
}
