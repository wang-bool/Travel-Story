// Explicit integration check against an isolated, already-running test service.
// TRAVEL_STORY_DATA_DIR must point to disposable test data, never your real library.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const base = process.env.TRAVEL_STORY_URL || 'http://127.0.0.1:3101';
const directory = process.env.TRAVEL_STORY_DATA_DIR;
assert.ok(directory?.startsWith('/tmp/travel-story-mcp.'), 'Use a disposable /tmp/travel-story-mcp.* data directory');
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/index.mjs', import.meta.url))], env: { ...process.env, TRAVEL_STORY_URL: base, TRAVEL_STORY_DATA_DIR: directory }, stderr: 'pipe' });
transport.stderr?.on('data', chunk => process.stderr.write(chunk));
const client = new Client({ name: 'travel-story-smoke', version: '1' });
await client.connect(transport);
export async function tool(name, args = {}) { const result = await client.callTool({ name, arguments: args }); if (result.isError)
    throw new Error(JSON.stringify(result.structuredContent ?? result.content)); return result.structuredContent; }
try {
    assert.equal((await client.listTools()).tools.length, 16);
    const status = await tool('get_status');
    assert.equal(status.capabilities.mcp, true);
    const created = await tool('create_trip', { presentation:{mode:'none'}, name: 'MCP 浏览器联调', startDate: '2026-11-01', endDate: '2026-11-03', requestId: crypto.randomUUID() });
    assert.equal(created.trip.days.length, 3);
    const web = await fetch(`${base}/api/travel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'edit_itinerary', input: { tripId: created.tripId, expectedRevision: created.revision, requestId: crypto.randomUUID(), operations: [{ op: 'add_stop', dayId: created.trip.days[0].id, place: { name: '巴黎圣母院（测试坐标）', latitude: 48.853, longitude: 2.3499, type: 'temple', city: 'Paris', country: 'France' } }, { op: 'add_stop', dayId: created.trip.days[0].id, place: { name: '卢浮宫（测试坐标）', latitude: 48.8606, longitude: 2.3376, type: 'museum', city: 'Paris', country: 'France' } }] } }) });
    assert.equal(web.status, 200);
    const edited = await web.json();
    const trip = await tool('get_trip', { tripId: created.tripId });
    assert.equal(trip.trip.stops.length, 2);
    const updated = await tool('update_trip', { presentation:{mode:'none'}, tripId: created.tripId, expectedRevision: trip.revision, requestId: crypto.randomUUID(), patch: { description: 'MCP 与手动编辑共用数据' } });
    const changed = await tool('edit_itinerary', { presentation:{mode:'none'}, tripId: created.tripId, expectedRevision: updated.revision, requestId: crypto.randomUUID(), operations: [{ op: 'set_transport', fromStopId: edited.trip.stops[0].id, toStopId: edited.trip.stops[1].id, transport: 'walk' }] });
    const routes = await tool('calculate_routes', { presentation:{mode:'none'}, tripId: created.tripId, expectedRevision: changed.revision, requestId: crypto.randomUUID() });
    assert.equal(routes.routes[0].quality, 'unavailable');
    assert.equal(routes.routes[0].duration, undefined);
    const legacy = await fetch(`${base}/api/trips`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trips: [] }) });
    assert.equal(legacy.status, 410);
    const unauthorized = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'get_status' }) });
    assert.equal(unauthorized.status, 403);
    console.log(JSON.stringify({ ok: true, tripId: created.tripId, dayId: created.trip.days[0].id, stopId: edited.trip.stops[0].id, url: created.url, checks: ['stdio discovery', 'create 3 days', 'web edits visible to MCP', 'MCP updates persisted', 'honest unsupported route', 'legacy write rejected', 'bridge auth'] }, null, 2));
}
finally {
    await client.close();
}
