import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyOperations, check, date, dayCount, makeTrip, normalize, patchTrip, place, shiftDate, text, TravelError, uid } from '../domain/itinerary.ts';
import { validateTrip } from '../domain/validateTrip.ts';
import { migrateTrip } from './tripMigration.ts';
import type { Trip, Transport, TripStop } from '../types.ts';
import { calculateSegmentRoute, type SegmentRouteResult } from './routeCalculation.ts';
type RequestRecord = {
    fingerprint: string;
    retained?: boolean;
    result: Record<string, any>;
};
type Database = {
    schemaVersion: 2;
    trips: Trip[];
    requests: Record<string, RequestRecord>;
    initialized: boolean;
    planOwners?: Record<string,string>;
};
const recoverablePlanErrors = new Set(['VIEW_NOT_CONNECTED','VIEW_NOT_READY','VIEW_FAILED','COMMAND_EXPIRED','PRESENTATION_FAILED','TASK_INTERRUPTED','TASK_FAILED']);
export const isRecoverablePlanError = (code?:string) => recoverablePlanErrors.has(code ?? '');
const empty = (): Database => ({ schemaVersion: 2, trips: [], requests: {}, initialized: false });
function pruneRequests(db: Database) {
    const disposable=Object.keys(db.requests).filter(id=>!db.requests[id].retained);
    for(const id of disposable.slice(0,Math.max(0,disposable.length-1000)))delete db.requests[id];
}
const canonical = (value: any): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export class TravelService {
    directory: string;
    private tail: Promise<unknown> = Promise.resolve();
    private listeners = new Set<() => void>();
    private planOwners = new Map<string,string>();
    private calculator: (from: TripStop, to: TripStop, transport: Transport) => Promise<SegmentRouteResult>;
    constructor(directory: string, calculator = calculateSegmentRoute) { this.directory = path.resolve(directory); this.calculator = calculator; }
    onChange(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    claimPlanTask(taskId:string,tripId:string) {
        return this.serial(async()=>{
            const db=await this.read(),owner=db.planOwners?.[tripId];
            check(!owner||owner===taskId,'PLAN_TASK_BUSY','Another plan task is editing this trip');
            check(db.trips.some(trip=>trip.id===tripId),'TRIP_NOT_FOUND','Trip not found');
            if(owner!==taskId){(db.planOwners??={})[tripId]=taskId;await this.write(db);this.notify();}
        });
    }
    releasePlanTask(taskId:string,tripId?:string) {
        return this.serial(async()=>{
            const db=await this.read();
            if(tripId&&db.planOwners?.[tripId]===taskId){delete db.planOwners[tripId];await this.write(db);this.notify();}
        });
    }
    isPlanTaskActive(tripId:string) {return this.planOwners.has(tripId);}
    private notify(){for(const fn of this.listeners){try{fn();}catch{}}}
    private async reconcilePlanOwners(db:Database){
        let changed=false;
        for(const [tripId,taskId] of Object.entries(db.planOwners??{})){
            try{
                const job=JSON.parse(await fs.readFile(path.join(this.directory,'agent-plans',`${taskId}.json`),'utf8'));
                // A crash can happen after the terminal journal rename but before lease cleanup.
                if(job.status==='completed'||job.status==='failed'&&!isRecoverablePlanError(job.error?.code)){delete db.planOwners![tripId];changed=true;}
            }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        }
        this.planOwners=new Map(Object.entries(db.planOwners??{}));
        return changed;
    }
    private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.tail.then(work, work); this.tail = next.catch(() => { }); return next; }
    private async read(): Promise<Database> {
        const file = path.join(this.directory, 'trips.json');
        let raw: string;
        try {
            raw = await fs.readFile(file, 'utf8');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT')
                return empty();
            throw e;
        }
        let parsed: any;
        try {
            parsed = JSON.parse(raw);
            check(parsed && Array.isArray(parsed.trips), 'STORAGE_CORRUPT', 'Invalid trips database');
        }
        catch (e) {
            if (e instanceof TravelError)
                throw e;
            throw new TravelError('STORAGE_CORRUPT', 'Cannot parse trips.json; original file has been preserved');
        }
        check(parsed.schemaVersion === undefined || parsed.schemaVersion === 1 || parsed.schemaVersion === 2, 'STORAGE_CORRUPT', 'Unsupported data schema version');
        if (parsed.schemaVersion === 2) {
            try {
                check(parsed.requests && typeof parsed.requests === 'object' && !Array.isArray(parsed.requests) && typeof parsed.initialized === 'boolean', 'STORAGE_CORRUPT', 'Invalid request journal');
                check(parsed.planOwners===undefined||parsed.planOwners&&typeof parsed.planOwners==='object'&&!Array.isArray(parsed.planOwners)&&Object.values(parsed.planOwners).every(owner=>typeof owner==='string'&&/^plan_[a-f0-9]{32}$/.test(owner)),'STORAGE_CORRUPT','Invalid plan owners');
                check(new Set(parsed.trips.map((t: Trip) => t.id)).size === parsed.trips.length, 'STORAGE_CORRUPT', 'Duplicate trips');
                for (const trip of parsed.trips)
                    validateTrip(trip);
                for (const entry of Object.values(parsed.requests) as RequestRecord[])
                    check(entry && typeof entry.fingerprint === 'string' && entry.result && typeof entry.result === 'object', 'STORAGE_CORRUPT', 'Invalid journal entry');
            }
            catch {
                throw new TravelError('STORAGE_CORRUPT', 'Invalid V2 database; original file has been preserved');
            }
            if(await this.reconcilePlanOwners(parsed)){await this.write(parsed);this.notify();}
            return parsed;
        }
        const migrated: Trip[] = [];
        try {
            for (const original of parsed.trips)
                migrated.push(migrateTrip(original));
        }
        catch {
            throw new TravelError('STORAGE_CORRUPT', 'Legacy data failed validation; original file has been preserved');
        }
        await fs.mkdir(this.directory, { recursive: true });
        await fs.writeFile(path.join(this.directory, 'trips.v1-backup.json'), raw, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST')
            throw e; });
        const db: Database = { schemaVersion: 2, trips: migrated, requests: {}, initialized: true };
        await this.write(db);
        return db;
    }
    private async write(db: Database) {
        for (const trip of db.trips)
            validateTrip(trip);
        await fs.mkdir(this.directory, { recursive: true });
        const file = path.join(this.directory, 'trips.json'), tmp = `${file}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(tmp, JSON.stringify(db));
            await fs.rename(tmp, file);
            this.planOwners=new Map(Object.entries(db.planOwners??{}));
        }
        finally {
            await fs.unlink(tmp).catch(() => { });
        }
    }
    snapshot() { return this.serial(async () => { const db = await this.read(); return { trips: db.trips.map(trip=>({...trip,...(this.isPlanTaskActive(trip.id)?{agentTaskActive:true}:{})})), initialized: db.initialized }; }); }
    releaseTaskReceipts(taskId: string) {
        check(/^plan_[a-f0-9]{32}$/.test(taskId),'INVALID_INPUT','Invalid task ID');
        return this.serial(async()=>{
            const db=await this.read();let changed=false;
            for(const [id,record] of Object.entries(db.requests))if(id.startsWith(`${taskId}:`)&&record.retained){delete record.retained;changed=true;}
            if(changed){pruneRequests(db);await this.write(db);}
        });
    }
    private async calculateRoutes(input: Record<string, any>, source: 'mcp' | 'web', retainRequest = false) {
        const requestId = text(input.requestId, 'requestId', 200), fingerprint = canonical({ action: 'calculate_routes', input, source });
        const prepared = await this.serial(async () => {
            const db = await this.read(), existing = Object.hasOwn(db.requests, requestId) ? db.requests[requestId] : undefined;
            check(source!=='web'||retainRequest||!db.planOwners?.[input.tripId],'PLAN_TASK_ACTIVE','Plan task owns route calculation');
            if (existing) {
                check(existing.fingerprint === fingerprint, 'REQUEST_ID_REUSED', 'requestId reused');
                return { existing: structuredClone(existing.result) };
            }
            const trip = db.trips.find(t => t.id === input.tripId);
            check(trip, 'TRIP_NOT_FOUND', 'Trip not found');
            check(input.expectedRevision === trip.revision, 'REVISION_CONFLICT', 'Reload trip before calculating routes');
            check(input.segmentIds === undefined || (Array.isArray(input.segmentIds) && input.segmentIds.length > 0 && input.segmentIds.length <= 100 && input.segmentIds.every((id: unknown) => trip.segments.some(s => s.id === id))), 'INVALID_INPUT', 'Invalid segmentIds');
            const segments = trip.segments.filter(s => !input.segmentIds || input.segmentIds.includes(s.id));
            check(segments.length <= 100, 'INVALID_INPUT', 'Calculate at most 100 segments per request');
            return { trip: structuredClone(trip), segments: structuredClone(segments) };
        });
        if (prepared.existing)
            return prepared.existing;
        const trip = prepared.trip!, segments = prepared.segments!;
        const calculated: {
            segment: typeof segments[number];
            result: SegmentRouteResult;
        }[] = [];
        for (let i = 0; i < segments.length; i += 4) {
            calculated.push(...await Promise.all(segments.slice(i, i + 4).map(async (segment) => ({ segment, result: await this.calculator(trip.stops.find(s => s.id === segment.fromStopId)!, trip.stops.find(s => s.id === segment.toStopId)!, segment.transport) }))));
        }
        return this.serial(async () => {
            const db = await this.read(), existing = Object.hasOwn(db.requests, requestId) ? db.requests[requestId] : undefined;
            check(source!=='web'||retainRequest||!db.planOwners?.[input.tripId],'PLAN_TASK_ACTIVE','Plan task owns route calculation');
            if (existing) {
                check(existing.fingerprint === fingerprint, 'REQUEST_ID_REUSED', 'requestId reused');
                return structuredClone(existing.result);
            }
            const current = db.trips.find(t => t.id === input.tripId);
            check(current && current.revision === input.expectedRevision, 'REVISION_CONFLICT', 'Trip changed while routes were calculating; reload and retry');
            for (const { segment, result } of calculated) {
                const target = current.segments.find(s => s.id === segment.id)!;
                target.route = result.route;
                target.distance = result.distance;
                target.duration = result.duration;
                const { route: _geometry, distance: _distance, duration: _duration, ...info } = result;
                target.routeInfo = info;
            }
            if (calculated.length)
                current.revision = (current.revision ?? 0) + 1;
            const result = { tripId: current.id, revision: current.revision, routes: calculated.map(({ segment, result }) => { const { route: _geometry, ...summary } = result; return { segmentId: segment.id, ...summary }; }) };
            db.initialized = true;
            if(retainRequest){
                const taskId=requestId.match(/^(plan_[a-f0-9]{32}):/)?.[1];
                check(taskId,'INVALID_INPUT','Retained requests require a plan task ID');
                const owner=db.planOwners?.[input.tripId];
                check(!owner||owner===taskId,'PLAN_TASK_BUSY','Another plan task is editing this trip');
                (db.planOwners??={})[input.tripId]=taskId;
            }else if(db.planOwners){delete db.planOwners[input.tripId];}
            Object.defineProperty(db.requests, requestId, { value: { fingerprint, result, ...(retainRequest ? {retained:true} : {}) }, writable: true, enumerable: true, configurable: true });
            pruneRequests(db);
            await this.write(db);
            for (const fn of this.listeners) {
                try {
                    fn();
                }
                catch { }
            }
            return result;
        });
    }
    execute(action: string, input: Record<string, any> = {}, source: 'mcp' | 'web' = 'mcp', options: {retainRequest?: boolean} = {}): Promise<Record<string, any>> {
        if (action === 'calculate_routes')
            return this.calculateRoutes(input, source, options.retainRequest === true);
        return this.serial(async () => {
            const db = await this.read();
            if (action === 'list_trips') {
                const limit = input.limit === undefined ? 20 : input.limit;
                check(Number.isInteger(limit) && limit > 0 && limit <= 100, 'INVALID_INPUT', 'limit must be 1-100');
                const cursor = input.cursor === undefined ? 0 : Number(input.cursor);
                check(Number.isInteger(cursor) && cursor >= 0, 'INVALID_INPUT', 'Invalid cursor');
                const q = typeof input.query === 'string' ? input.query.toLowerCase() : '';
                const items = db.trips.filter(t => `${t.name} ${t.region ?? ''}`.toLowerCase().includes(q));
                return { trips: items.slice(cursor, cursor + limit).map(t => ({ id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate, region: t.region, days: t.days.length, stops: t.stops.length, revision: t.revision })), nextCursor: cursor + limit < items.length ? String(cursor + limit) : null };
            }
            if (action === 'get_trip') {
                const t = db.trips.find(t => t.id === input.tripId);
                check(t, 'TRIP_NOT_FOUND', 'Trip not found');
                return { trip: structuredClone(t), tripId: t.id, revision: t.revision };
            }
            check(['create_trip', 'update_trip', 'delete_trip', 'edit_itinerary', 'import_legacy'].includes(action), 'INVALID_INPUT', 'Unknown action');
            const requestId = text(input.requestId, 'requestId', 200), fingerprint = canonical({ action, input, source });
            if (Object.hasOwn(db.requests, requestId)) {
                check(db.requests[requestId].fingerprint === fingerprint, 'REQUEST_ID_REUSED', 'Use a new requestId for different arguments');
                return structuredClone(db.requests[requestId].result);
            }
            let result: Record<string, any>;
            if (action === 'create_trip') {
                const trip = makeTrip(input);
                db.trips.unshift(trip);
                result = { tripId: trip.id, revision: trip.revision, trip };
            }
            else if (action === 'import_legacy') {
                check(source === 'web' && !db.initialized && db.trips.length === 0, 'IMPORT_CONFLICT', 'Import is only allowed into an uninitialized empty store');
                check(Array.isArray(input.trips) && input.trips.length <= 100, 'INVALID_INPUT', 'Invalid legacy import');
                const migrated: Trip[] = [];
                for (const old of input.trips)
                    migrated.push(migrateTrip(old));
                check(new Set(migrated.map(t => t.id)).size === migrated.length, 'INVALID_INPUT', 'Duplicate trip IDs');
                db.trips = migrated;
                result = { imported: migrated.length };
            }
            else {
                const trip = db.trips.find(t => t.id === input.tripId);
                check(trip, 'TRIP_NOT_FOUND', 'Trip not found');
                check(Number.isInteger(input.expectedRevision) && input.expectedRevision === trip.revision, 'REVISION_CONFLICT', `Trip changed; reload before editing (current revision ${trip.revision})`);
                if (action === 'delete_trip') {
                    db.trips = db.trips.filter(t => t.id !== trip.id);
                    result = { tripId: trip.id, deleted: true, revision: trip.revision };
                }
                else {
                    let extra: Record<string, unknown> = {};
                    if (action === 'update_trip')
                        patchTrip(trip, input.patch);
                    else {
                        const ops = structuredClone(input.operations);
                        check(Array.isArray(ops), 'INVALID_INPUT', 'operations must be an array');
                        for (const op of ops) {
                            check(op && typeof op === 'object', 'INVALID_INPUT', 'Invalid operation');
                            if (source === 'mcp') {
                                check(!op.place, 'INVALID_INPUT', 'Use a search candidateId');
                                check(!['add_media', 'remove_media', 'set_route'].includes(op.op), 'INVALID_INPUT', 'Internal web operation');
                            }
                            if (op.candidateId) {
                                check(['add_stop', 'update_stop'].includes(op.op), 'INVALID_INPUT', 'Unexpected candidateId');
                                const { resolveCandidate } = await import('./placeSearch.ts');
                                op.place = await resolveCandidate(op.candidateId);
                            }
                        }
                        // Raw MCP places and internal operations were rejected before resolving trusted candidates.
                        extra = applyOperations(trip, ops, true);
                    }
                    trip.revision = (trip.revision ?? 0) + 1;
                    result = { tripId: trip.id, revision: trip.revision, trip, ...extra };
                }
            }
            db.initialized = true;
            if(options.retainRequest){
                const taskId=requestId.match(/^(plan_[a-f0-9]{32}):/)?.[1];
                check(taskId,'INVALID_INPUT','Retained requests require a plan task ID');
                const owner=db.planOwners?.[result.tripId];
                check(!owner||owner===taskId,'PLAN_TASK_BUSY','Another plan task is editing this trip');
                (db.planOwners??={})[result.tripId]=taskId;
            }else if(input.tripId&&db.planOwners){
                // A deliberate successful edit supersedes the suspended plan's revision.
                delete db.planOwners[input.tripId];
            }
            Object.defineProperty(db.requests, requestId, { value: { fingerprint, result: structuredClone(result), ...(options.retainRequest ? {retained:true} : {}) }, writable: true, enumerable: true, configurable: true });
            pruneRequests(db);
            await this.write(db);
            for (const fn of this.listeners) {
                try {
                    fn();
                }
                catch { }
            }
            return structuredClone(result);
        });
    }
}
const root = globalThis as typeof globalThis & {
    __travelService?: TravelService;
};
export function getTravelService() { return root.__travelService ??= new TravelService(process.env.TRAVEL_STORY_DATA_DIR || path.join(process.cwd(), 'data')); }
