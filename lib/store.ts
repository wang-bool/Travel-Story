// Browser cache. All mutations are committed by the shared local service.
import type { MediaMeta, Transport, Trip, TripSegment, TripStop } from './types';
export const DEFAULT_TRANSPORT: Transport = 'car';
const STORAGE_KEY = 'travel-story:v1';
const LEGACY_BACKUP_KEY = 'travel-story:legacy-backup';
let cache: Trip[] = [];
let syncPromise: Promise<void> | null = null;
let eventSource: EventSource | null = null;
let loadSequence = 0;
let queue: Promise<unknown> = Promise.resolve();
let syncState = { saving: 0, error: '', connected: false, legacyAvailable: false, legacyPreserved: false };
const listeners = new Set<() => void>();
const statusListeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
const status = (patch: Partial<typeof syncState>) => { syncState = { ...syncState, ...patch }; statusListeners.forEach(fn => fn()); };
export function subscribeStatus(fn: () => void) { statusListeners.add(fn); return () => { statusListeners.delete(fn); }; }
export const getSyncStatus = () => syncState;
function legacyTrips(): Trip[] { try {
    const old = JSON.parse(localStorage.getItem(LEGACY_BACKUP_KEY) || localStorage.getItem(STORAGE_KEY) || '{}');
    return old.cacheVersion !== 2 && Array.isArray(old.trips) ? old.trips : [];
}
catch {
    return [];
} }
function preserveLegacy() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || localStorage.getItem(LEGACY_BACKUP_KEY))
        return true;
    try {
        const old = JSON.parse(raw);
        if (old.cacheVersion !== 2 && Array.isArray(old.trips) && old.trips.length)
            localStorage.setItem(LEGACY_BACKUP_KEY, raw);
        return true;
    }
    catch {
        return false;
    }
}
export function downloadLegacyBackup() { const raw = localStorage.getItem(LEGACY_BACKUP_KEY) || localStorage.getItem(STORAGE_KEY); if (!raw)
    return; const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'travel-story-browser-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export async function refreshTrips() {
    const sequence = ++loadSequence;
    const res = await fetch('/api/trips', { cache: 'no-store' });
    if (!res.ok)
        throw new Error('无法读取行程，请检查本地服务');
    const db = await res.json();
    if (sequence !== loadSequence)
        return;
    const preserved = preserveLegacy();
    cache = db.trips;
    const legacy = legacyTrips();
    status({ connected: true, legacyAvailable: !db.initialized && cache.length === 0 && legacy.length > 0, legacyPreserved: legacy.some(t => !cache.some(current => current.id === t.id)) });
    // Do not overwrite browser-only legacy data before an explicit import.
    if (preserved && !syncState.legacyAvailable)
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ cacheVersion: 2, seeded: true, trips: cache }));
        }
        catch { }
    notify();
}
function startSync() {
    if (typeof window === 'undefined')
        return;
    if (!syncPromise)
        syncPromise = refreshTrips().catch(e => status({ connected: false, error: e.message }));
    if (!eventSource) {
        eventSource = new EventSource('/api/events');
        eventSource.onopen = () => { refreshTrips().catch(e => status({ connected: false, error: e.message })); };
        eventSource.onmessage = () => { refreshTrips().catch(e => status({ connected: false, error: e.message })); };
        eventSource.onerror = () => status({ connected: false });
    }
}
export function whenSynced() { startSync(); return syncPromise ?? Promise.resolve(); }
export function subscribe(fn: () => void) { listeners.add(fn); startSync(); return () => { listeners.delete(fn); }; }
export const getSnapshot = () => cache;
export const getTrip = (id: string) => cache.find(t => t.id === id) ?? null;
function action(name: string, input: Record<string, unknown>, tripId?: string): Promise<Record<string, any>> {
    status({ saving: syncState.saving + 1, error: '' });
    const run = async () => {
        await whenSynced();
        if (!syncState.connected)
            await refreshTrips();
        const trip = tripId ? getTrip(tripId) : null;
        if (tripId && !trip)
            throw new Error('行程不存在，请重新打开页面');
        const res = await fetch('/api/travel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name, input: { ...input, ...(tripId ? { tripId, expectedRevision: trip!.revision } : {}), requestId: crypto.randomUUID() } }) });
        const body = await res.json();
        if (!res.ok) {
            await refreshTrips().catch(() => { });
            throw new Error(body.error?.message || body.error || '保存失败');
        }
        // A commit succeeded even if the following read disconnects; never invite duplicate retries.
        ++loadSequence;
        if (body.trip) {
            const current = cache.find(t => t.id === body.trip.id);
            if (!current || (body.revision ?? 0) >= (current.revision ?? 0))
                cache = [body.trip, ...cache.filter(t => t.id !== body.trip.id)];
        }
        if (body.deleted)
            cache = cache.filter(t => t.id !== body.tripId);
        notify();
        try {
            await refreshTrips();
        }
        catch {
            status({ connected: false, error: '修改已保存，但界面同步失败，请恢复连接后刷新。' });
        }
        return body;
    };
    const next = queue.then(run, run);
    queue = next.catch(() => { });
    next.catch(e => status({ error: `修改未保存：${e.message}` })).finally(() => status({ saving: Math.max(0, syncState.saving - 1) }));
    return next;
}
export async function importLegacy() { return action('import_legacy', { trips: legacyTrips() }); }
export async function createTrip(input: {
    name: string;
    startDate: string;
    endDate: string;
    origin?: string;
    region?: string;
    description?: string;
    isPublic?: boolean;
}): Promise<Trip> { return (await action('create_trip', input)).trip; }
export async function updateTrip(id: string, patch: Partial<Trip>) { return (await action('update_trip', { patch }, id)).trip as Trip; }
export async function deleteTrip(id: string) { await action('delete_trip', {}, id); }
export async function editItinerary(tripId: string, operations: Record<string, unknown>[]) { return action('edit_itinerary', { operations }, tripId); }
export async function addDay(id: string): Promise<Trip> { return (await editItinerary(id, [{ op: 'add_day' }])).trip; }
export async function removeDay(id: string, dayId: string) { return editItinerary(id, [{ op: 'remove_day', dayId, stopHandling: 'delete' }]); }
export async function addStop(id: string, dayId: string, input: Omit<TripStop, 'id' | 'dayId' | 'day' | 'order'>): Promise<Trip> { return (await editItinerary(id, [{ op: 'add_stop', dayId, place: input }])).trip; }
export async function removeStop(id: string, stopId: string) { return editItinerary(id, [{ op: 'remove_stop', stopId }]); }
export async function moveStop(id: string, stopId: string, targetDayId: string | null, position: number) { return editItinerary(id, [{ op: 'move_stop', stopId, targetDayId, position }]); }
export async function setStopTransport(id: string, fromStopId: string, transport: Transport) { const trip = getTrip(id); const seg = trip?.segments.find(s => s.fromStopId === fromStopId); if (!seg)
    throw new Error('路段不存在'); return editItinerary(id, [{ op: 'set_transport', fromStopId, toStopId: seg.toStopId, transport }]); }
export async function addStopMedia(id: string, stopId: string, media: MediaMeta) { return editItinerary(id, [{ op: 'add_media', stopId, media }]); }
export async function removeStopMedia(id: string, stopId: string, mediaId: string) { return editItinerary(id, [{ op: 'remove_media', stopId, mediaId }]); }
export async function setSegmentRoute(id: string, fromStopId: string, seg: TripSegment) { return editItinerary(id, [{ op: 'set_route', segmentId: seg.id, fromStopId, toStopId: seg.toStopId, transport: seg.transport, route: seg.route, distance: seg.distance, duration: seg.duration, routeInfo: seg.routeInfo }]); }
export function toDateStr(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export const todayStr = () => toDateStr(new Date());
export function formatDateCN(s: string) { if (!s)
    return ''; const [, m, d] = s.split('-'); return `${Number(m)}月${Number(d)}日`; }
export function stopsByDay(trip: Trip) { const result = new Map<string, TripStop[]>(); for (const s of trip.stops) {
    const a = result.get(s.dayId) ?? [];
    a.push(s);
    result.set(s.dayId, a);
} return result; }
export const tripDays = (trip: Trip) => trip.days.length;
