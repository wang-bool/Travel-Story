import { check, date, dayCount, place, transport, weather } from './itinerary.ts';
import type { Trip } from '../types.ts';
const id = (s: unknown) => typeof s === 'string' && /^[\w-]{1,128}$/.test(s);
const unique = (items: unknown[]) => new Set(items).size === items.length;
export function validateTrip(value: unknown, current = true): asserts value is Trip {
    const t = value as Trip;
    check(t && id(t.id) && typeof t.name === 'string' && t.name.length > 0 && Array.isArray(t.days) && t.days.length > 0 && t.days.length <= 366 && Array.isArray(t.stops) && Array.isArray(t.segments), 'STORAGE_CORRUPT', 'Invalid trip structure');
    date(t.startDate);
    date(t.endDate);
    dayCount(t.startDate, t.endDate);
    check(Number.isFinite(t.createdAt) && typeof t.isPublic === 'boolean', 'STORAGE_CORRUPT', 'Invalid trip metadata');
    if (current)
        check(Number.isInteger(t.revision) && t.revision! > 0 && t.endDate === t.days.at(-1)!.date && dayCount(t.startDate, t.endDate) === t.days.length, 'STORAGE_CORRUPT', 'Invalid trip revision/dates');
    check(unique(t.days.map(d => d.id)) && unique(t.stops.map(s => s.id)) && unique(t.segments.map(s => s.id)), 'STORAGE_CORRUPT', 'Duplicate identifiers');
    for (const d of t.days) {
        check(id(d.id) && Number.isInteger(d.day) && d.day > 0, 'STORAGE_CORRUPT', 'Invalid day');
        date(d.date);
        if (d.weather !== undefined)
            weather(d.weather);
    }
    for (const s of t.stops) {
        place(s);
        check(id(s.id) && t.days.some(d => d.id === s.dayId) && Number.isInteger(s.day) && Number.isInteger(s.order) && s.order >= 0, 'STORAGE_CORRUPT', 'Invalid stop');
        if (s.media)
            check(Array.isArray(s.media) && s.media.every(m => id(m.id) && ['image', 'video'].includes(m.kind) && typeof m.name === 'string' && Number.isFinite(m.createdAt)), 'STORAGE_CORRUPT', 'Invalid media');
    }
    for (const s of t.segments) {
        transport(s.transport);
        check(id(s.id) && t.stops.some(p => p.id === s.fromStopId) && t.stops.some(p => p.id === s.toStopId), 'STORAGE_CORRUPT', 'Invalid segment');
        if (s.route)
            check(s.route.type === 'LineString' && Array.isArray(s.route.coordinates) && s.route.coordinates.length >= 2 && s.route.coordinates.every(c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90), 'STORAGE_CORRUPT', 'Invalid geometry');
    }
}
