# Travel Story V2 MCP design

Approved in conversation on 2026-10-29. Work locally on branch v2.

## Product
Keep the browser UI. An external Agent uses MCP tools to search places, edit the same trips as the user, calculate truthful routes, open the browser and control connected pages. No embedded MCP App, new Agent, installer, Skill or automated video export in this iteration.

## Contracts
13 tools: get_status, list_trips, get_trip, search_places, create_trip, update_trip, edit_itinerary, delete_trip, calculate_routes, open_trip, get_view_state, control_view, get_command. Mutation parameters: requestId and expectedRevision (except creation). JSON-schema validated input; structured results and readable text; tool errors use isError.
Search accepts query, countryCode, city, language, near and limit; returns source status, provenance, coordinates in WGS84, candidateId and expiry. Agent handles aliases/translations and ambiguity. Candidate registry belongs to the local service. No invented provider fields.
Itinerary edits are atomic ordered operations: add/remove day, add/update/remove/move stop, set transport. Optional clientRef allows within-batch references. Server generates identifiers; endpoints and transport govern route invalidation.
Server owns data. Serialize read/check/mutate/write in one process; persist request deduplication with data. Preserve old trip/media files. Migrate legacy dates, backup prior to first migration, distinguish malformed storage from absent storage. Reject old whole-database writes. Web writes must use the same service, including media metadata and geographic enrichment. Reconnect reloads authority; explicit save errors; do not resurrect deleted trips from cache.
Route calculation happens outside write lock and checks version before saving. No driving durations presented as walking/rail/flight duration; source, actual profile, geometry kind and quality returned. Geometries excluded from MCP default summaries.
Views register with heartbeat and command acknowledgement. Commands have expiry and explicit loading/execution/failure states. Browser opening does not claim page/map readiness or foreground focus. First version supports play/stop/restart, not pause/resume. Trip changes stop playback. Only local application URLs may be opened. Local service validates Host/Origin and bridge token.

## Verification
Concurrent writes conflict without lost data; idempotent retries; transaction rollback; invalid identifiers; date changes; A-B route invalidation after reorder; stale route calculation; candidate expiry; source errors; view selection/expiry/ack; protocol discovery/call; browser manual/MCP synchronization; test, typecheck and production build.
