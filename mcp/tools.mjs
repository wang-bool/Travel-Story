import { z } from 'zod';
import {planReviewSchema} from './planReview.mjs';
const id = z.string().min(1).max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const request = { requestId: id.describe('Unique mutation ID. Reuse exactly the same ID and arguments for retries; keep IDs unique across tools.') };
const presentation = z.object({ mode: z.enum(['auto', 'none']).optional(), viewId: id.optional() }).strict().optional().describe('Browser presentation is automatic by default. Set mode:none only for intentional background work; use viewId to select among multiple application windows.');
const mutation = { tripId: id, expectedRevision: z.number().int().positive().describe('Latest revision from get_trip. Reload after REVISION_CONFLICT.'), ...request, presentation };
const transport = z.enum(['car', 'bus', 'train', 'subway', 'plane', 'ship', 'kayak', 'motorcycle', 'bicycle', 'scooter', 'walk', 'horse', 'ufo', 'swim', 'rocket']);
const position = z.number().int().min(0).optional();
const operations = z.discriminatedUnion('op', [
    z.object({ op: z.literal('add_day'), position }).strict(),
    z.object({ op: z.literal('remove_day'), dayId: id, stopHandling: z.enum(['delete', 'move']).optional(), targetDayId: id.optional() }).strict(),
    z.object({ op: z.literal('add_stop'), dayId: id, candidateId: id, position, clientRef: id.optional() }).strict(),
    z.object({ op: z.literal('update_stop'), stopId: id, candidateId: id.optional(), patch: z.object({ name: z.string().min(1).max(300).optional(), city: z.string().max(500).optional(), country: z.string().max(500).optional() }).strict().optional() }).strict(),
    z.object({ op: z.literal('remove_stop'), stopId: id }).strict(),
    z.object({ op: z.literal('move_stop'), stopId: id, targetDayId: id, position: z.number().int().min(0) }).strict(),
    z.object({ op: z.literal('set_transport'), fromStopId: id, toStopId: id, transport }).strict(),
    z.object({ op: z.literal('set_weather'), dayId: id, weather: z.object({ label: z.string().min(1).max(100), low: z.number().optional(), high: z.number().optional(), effect: z.enum(['sun', 'cloud', 'overcast', 'fog', 'drizzle', 'rain', 'heavy-rain', 'snow', 'heavy-snow', 'breeze', 'wind', 'storm']).optional() }).strict().nullable().describe('Daily weather from get_weather days[]; null clears the day\'s weather.') }).strict(),
]);
const patch = z.object({ name: z.string().min(1).max(200).optional(), origin: z.string().max(5000).optional(), region: z.string().max(5000).optional(), description: z.string().max(5000).optional(), startDate: date.optional(), endDate: date.optional(), isPublic: z.boolean().optional() }).strict();
const record = z.record(z.string(), z.unknown());
const revised = { tripId: id, revision: z.number().int().positive() };
const trip = z.object({ id, name: z.string(), startDate: date, endDate: date, days: z.array(record), stops: z.array(record), segments: z.array(record) }).passthrough();
const receipt = z.object({ commandId: id, status: z.string() }).passthrough();
const planStop = z.object({candidateId:id.optional(),stopId:id.optional(),transportToNext:transport.optional()}).strict().refine(s=>Boolean(s.candidateId)!==Boolean(s.stopId), 'Choose candidateId or existing stopId');
const planInput = {
    ...request, viewId:id, tripId:id.optional(), expectedRevision:z.number().int().positive().optional(),
    trip:z.object({name:z.string().min(1).max(200),startDate:date,endDate:date,origin:z.string().max(5000).optional(),region:z.string().max(5000).optional(),description:z.string().max(5000).optional()}).strict(),
    days:z.array(z.object({date,stops:z.array(planStop).max(100)}).strict()).min(1).max(366),
    review:planReviewSchema.optional().describe('Required for every NEW task: geographical rationale and complete daily time budgets with duration/scope evidence. Omit only when resuming an older persisted task that originally had no review. Never bypass review errors with lower-level tools.'),
    finish:z.enum(['plan','play']).optional(),calculateRoutes:z.boolean().optional(),
};
const taskResult = z.object({taskId:id,status:z.enum(['running','completed','failed']),tripId:id.optional(),revision:z.number().int().positive().optional(),url:z.string().optional(),progress:z.object({completed:z.number(),total:z.number(),label:z.string()}),error:z.object({code:z.string(),message:z.string()}).optional(),resumable:z.boolean()});
const outputs = {
    apply_plan:taskResult,
    get_plan_task:taskResult,
    ensure_service: z.object({status:z.enum(['running','started']),url:z.string(),launched:z.boolean(),pid:z.number().int().positive().optional(),logPath:z.string().optional()}),
    get_status: z.object({ version: z.string(), search: record, connectedViews: z.number(), capabilities: record, url:z.string().optional(),views:z.array(record).optional(),compatibility:record.optional() }),
    list_trips: z.object({ trips: z.array(record), nextCursor: z.string().nullable() }),
    get_trip: z.object({ ...revised, trip, url: z.string() }),
    search_places: z.object({ status: z.enum(['ok', 'partial', 'failed', 'not_configured']), candidates: z.array(record), providerStatus: z.array(record), expiresAt: z.string(), searchContext: record, contextHandling: record }).passthrough(),
    get_weather: z.object({ location: record, timezone: z.string().optional(), days: z.array(record), note: z.string().optional(), source: z.string(), attribution: z.string(), usage: z.string(), cached: z.boolean() }).passthrough(),
    create_trip: z.object({ ...revised, trip, url: z.string() }),
    update_trip: z.object({ ...revised, trip, url: z.string() }),
    edit_itinerary: z.object({ ...revised, trip, url: z.string(), results: z.array(record), invalidatedSegmentIds: z.array(id) }),
    delete_trip: z.object({ ...revised, deleted: z.boolean() }),
    calculate_routes: z.object({ ...revised, routes: z.array(record) }),
    open_trip: receipt.extend({ url: z.string(), error: z.string().optional() }),
    get_view_state: z.object({ views: z.array(record) }),
    control_view: receipt,
    get_command: receipt,
};
const visibleResult = z.object({ status: z.enum(['completed', 'pending', 'failed', 'skipped']), commandId: id.optional(), openCommandId: id.optional(), viewId: id.optional(), url: z.string().optional(), code: z.string().optional(), error: z.string().optional() });
for (const name of ['create_trip', 'update_trip', 'edit_itinerary', 'calculate_routes', 'delete_trip'])
    outputs[name] = outputs[name].extend({ presentation: visibleResult.optional() });
const define = (name, description, input, readOnly = false) => ({ name, description, schema: z.object(input).strict(), outputSchema: outputs[name], annotations: { readOnlyHint: readOnly, destructiveHint: name === 'delete_trip' || name === 'edit_itinerary' || name === 'apply_plan', idempotentHint: readOnly || ['ensure_service', 'create_trip', 'update_trip', 'delete_trip', 'edit_itinerary', 'calculate_routes','apply_plan'].includes(name), openWorldHint: name === 'search_places' || name === 'calculate_routes' } });
const weatherInput = z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    city: z.string().min(1).max(200).optional().describe('City name, geocoded via the search providers; coordinates from search_places candidates are more reliable'),
    startDate: date, endDate: date,
}).strict().superRefine((v, ctx) => {
    const hasCoords = v.latitude !== undefined || v.longitude !== undefined;
    if (hasCoords ? (v.latitude === undefined || v.longitude === undefined) : !v.city) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide latitude+longitude or city' });
    if (v.startDate > v.endDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'startDate must be on or before endDate' });
    if ((Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 + 1 > 16) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date range too long (max 16 days per call)' });
});
export const toolDefinitions = [
    define('apply_plan', 'Submit one feasible confirmed plan using valid candidateIds or existing stopIds. NEW tasks require review with geographical grouping/necessary-return rationale and a time budget for every submitted date: availableMinutes, travelMinutes, visitMinutes, mealRestMinutes, bufferMinutes, basis. Check actual visit scope and sources before estimating; coordinates and driving durations do not establish visit duration. Overfull days are rejected before writing. Requires an already-rendered ready viewId. The server freezes candidates, journals steps, waits for visible acknowledgements, calculates routes and optionally plays. Use get_plan_task with long wait. Resume with the same requestId and unchanged plan; only viewId may change. Existing trips require expectedRevision and all existing stopIds. Provide transportToNext on every non-final flattened stop. Do not fall back to low-level tools after review or version errors.', planInput),
    define('get_plan_task', 'Read compact plan task progress, optionally wait up to 20 seconds for completion. Prefer waitMs=15000 over repeated short polls. On recoverable failure restore the page and resubmit apply_plan with the same requestId and plan, not a new trip.', {taskId:id,waitMs:z.number().int().min(0).max(20000).optional()}, true),
    define('ensure_service', 'Ensure the configured local Travel Story application is running. Reuse an authenticated existing service; otherwise launch the installed local app on its configured port and wait for readiness. Does not install dependencies, change ports or stop processes. Use after SERVICE_UNAVAILABLE; available through stdio even while the app is offline.', {}),
    define('get_status', 'First call: check running app URL, search providers, capabilities, connected views and bridge compatibility. compatibility.status=restart_required means restart the updated web app and reconnect; ensure_service does not replace an old process. Do not fall back to lower-level writes or browser forms. compatible confirms protocol support, not itinerary feasibility.', {}, true),
    define('list_trips', 'List trip summaries with opaque pagination cursor.', { query: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional() }, true),
    define('get_trip', 'Read current trip, days, stops, route summaries, media metadata, revision and URL. Route geometry excluded.', { tripId: id }, true),
    define('search_places', 'Search real places. Use trip country/city context. If Chinese query yields insufficient matches, retry English, local names or aliases. Compare address, country, type and coordinates; never assume the first candidate is correct. Select clearly matching candidate; ask the user if ambiguous. Search failures are not evidence a place does not exist. city is a search hint for LocationIQ, not an exact boundary filter. Candidate IDs expire. Reuse valid candidates instead of repeating searches. Set viewId to show live search inputs/results in that connected page.', { query: z.string().min(1).max(500), countryCode: z.string().regex(/^[A-Za-z]{2}$/).optional(), city: z.string().max(200).optional(), language: z.string().max(100).optional(), near: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict().optional(), limit: z.number().int().min(1).max(20).optional(), viewId:id.optional() }, true),
    define('create_trip', 'Create a trip and one day for every date in the inclusive date range (max 366 days). Automatically opens and presents the trip unless presentation.mode is none.', { name: z.string().min(1).max(200), startDate: date, endDate: date, origin: z.string().max(5000).optional(), region: z.string().max(5000).optional(), description: z.string().max(5000).optional(), ...request, presentation }),
    define('update_trip', 'Edit trip metadata/dates. Moving startDate alone shifts all days. Shortening occupied days fails; move/remove their stops first. Automatically presents the change in the browser.', { ...mutation, patch }),
    define('edit_itinerary', 'Apply 1-100 operations atomically. Use search candidateId to add/replace places, never invent coordinates. Position is zero-based within a day; omitted means append. clientRef references a newly added stop later in this batch. Changing endpoints/transport invalidates routes. Removing an occupied day requires stopHandling. Automatically opens/reuses the trip page, synchronizes its revision and focuses the changed stop/day. Check presentation.status; a presentation failure does not undo saved data and should not trigger another data mutation.', { ...mutation, operations: z.array(operations).min(1).max(100) }),
    define('delete_trip', 'Delete a trip after explicit user intent to delete it. Media files are retained.', mutation),
    define('calculate_routes', 'Calculate and persist requested segments (or all segments). Read quality and warnings: unsupported modes have no duration; flights/water connections are illustrative, not schedules. Geometry stays in the app. Automatically presents updated routes unless presentation.mode is none.', { ...mutation, segmentIds: z.array(id).min(1).max(100).optional() }),
    define('open_trip', 'Navigate the connected application window to a trip, reusing its current window across pages. Launch the application only if none is connected. Specify viewId if multiple windows exist. Query get_command for readiness; browser foreground focus is best effort.', { tripId: id, viewId: id.optional(), page: z.enum(['plan', 'play']).optional(), dayId: id.optional(), stopId: id.optional() }),
    define('get_view_state', 'List connected application windows, current routes, map readiness, selection and playback state. Use viewId to target a specific window.', { viewId: id.optional() }, true),
    define('control_view', 'Control a connected ready page. show_day/focus_stop/fit_trip work on plan and play pages; play/restart/stop require a play page. Returns a receipt, not execution success; query get_command. No pause/resume.', { viewId: id, action: z.enum(['show_day', 'focus_stop', 'fit_trip', 'play', 'restart', 'stop']), dayId: id.optional(), stopId: id.optional() }),
    define('get_command', 'Read browser-open or page-command receipt. completed means page acknowledged execution/connection; expired means no timely confirmation.', { commandId: id }, true),
    { name: 'get_weather', description: 'Daily weather forecast (Open-Meteo, no key needed). Prefer latitude/longitude from search_places candidates; city name works when search keys are configured. Covers roughly the past 7 days through 16 days ahead; out-of-range dates are truncated with a note or rejected with OUT_OF_FORECAST_RANGE. Each day returns label/low/high/effect ready for edit_itinerary set_weather, plus precipitation and wind. This forecast does not replace official severe-weather warnings; verify those via web sources.', schema: weatherInput, outputSchema: outputs.get_weather, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
];
export function validateTool(name, args) {
    const tool = toolDefinitions.find(t => t.name === name);
    if (!tool)
        throw Object.assign(new Error('Unknown tool'), { code: 'UNKNOWN_TOOL' });
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success)
        throw Object.assign(new Error(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')), { code: 'INVALID_INPUT' });
    return parsed.data;
}
