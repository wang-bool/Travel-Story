// Browser integration with deterministic empty map tiles, using disposable data only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const directory = process.env.TRAVEL_STORY_DATA_DIR;
assert.ok(directory?.startsWith('/tmp/travel-story-mcp.'), 'Use disposable data');
const base = process.env.TRAVEL_STORY_URL || 'http://127.0.0.1:3101';
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const value = await fn();
        if (value)
            return value;
        await delay(300);
    }
    throw new Error(`Timed out: ${label}`);
}
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp/index.mjs', import.meta.url))], env: { ...process.env, TRAVEL_STORY_URL: base }, stderr: 'inherit' });
const client = new Client({ name: 'browser-smoke', version: '1' });
await client.connect(transport);
const tool = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError)
        throw new Error(JSON.stringify(r.content));
    return r.structuredContent;
};
let chrome, ws;
const pending = new Map();
let sequence = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000); pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
};
try {
    const created = await tool('create_trip', { presentation: { mode: 'none' }, name: '浏览器联调', startDate: '2026-11-01', endDate: '2026-11-01', requestId: crypto.randomUUID() });
    const response = await fetch(`${base}/api/travel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'edit_itinerary', input: { tripId: created.tripId, expectedRevision: created.revision, requestId: crypto.randomUUID(), operations: [{ op: 'add_stop', dayId: created.trip.days[0].id, place: { name: '巴黎圣母院（测试）', latitude: 48.853, longitude: 2.3499, type: 'temple', city: 'Paris', country: 'France' } }] } }) });
    assert.equal(response.status, 200);
    const edited = await response.json();
    const profile = path.join(directory, `chrome-${Date.now()}`);
    await mkdir(profile);
    chrome = spawn(process.env.CHROME_PATH || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
    const port = await until(async () => {
        try {
            return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
        }
        catch {
            return false;
        }
    }, 'Chrome debug port');
    const target = await until(async () => {
        try {
            return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
        }
        catch {
            return false;
        }
    }, 'Chrome target');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const errors = [];
    ws.onmessage = event => {
        const message = JSON.parse(String(event.data));
        if (message.id) {
            const p = pending.get(message.id);
            if (p) {
                pending.delete(message.id);
                message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
            }
        }
        else if (message.method === 'Fetch.requestPaused') {
            const { requestId, request } = message.params;
            const planet = new URL(request.url).pathname === '/api/tiles/planet';
            const body = planet ? JSON.stringify({ tilejson: '3.0.0', tiles: [`${base}/api/tiles/smoke/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 0, vector_layers: [] }) : '';
            void call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: planet ? 'application/json' : 'application/x-protobuf' }], body: Buffer.from(body).toString('base64') }).catch(() => { });
        }
        else if (message.method === 'Runtime.exceptionThrown')
            errors.push(message.params.exceptionDetails);
    };
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Fetch.enable', { patterns: [{ urlPattern: '*/api/tiles/*', requestStage: 'Request' }] });
    await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.EventSource = class { close() {} };' });
    await call('Page.navigate', { url: base });
    const home = await until(async()=> (await tool('get_view_state')).views.find(v=>v.page==='home' && v.ready),'root bridge on homepage');
    const homeNavigation = await tool('open_trip',{tripId:created.tripId,viewId:home.viewId});
    assert.equal(homeNavigation.reused,true);
    await until(async()=>{const r=await tool('get_command',{commandId:homeNavigation.commandId});if(['failed','expired'].includes(r.status))throw Error(JSON.stringify(r));return r.status==='completed';},'home to plan internal navigation');
    await until(() => evaluate('!!document.querySelector(".add-day-btn")'), 'React plan page');
    const view = await until(async () => { const r = await tool('get_view_state'); return r.views.find(v => v.tripId === created.tripId && v.ready); }, 'loaded map and heartbeat');
    assert.equal(view.viewId,home.viewId,'window identity survives home to plan');
    const focus = await tool('control_view', { viewId: view.viewId, action: 'focus_stop', stopId: edited.trip.stops[0].id });
    await until(async () => {
        const r = await tool('get_command', { commandId: focus.commandId });
        if (['failed', 'expired'].includes(r.status))
            throw new Error(JSON.stringify(r));
        return r.status === 'completed';
    }, 'focus receipt');
    await evaluate('document.querySelector(".add-day-btn").click()');
    await until(async () => { const r = await tool('get_trip', { tripId: created.tripId }); return r.trip.days.length === 2; }, 'manual add day visible to MCP');
    const current = await tool('get_trip', { tripId: created.tripId });
    await delay(1200);
    const cameraBefore = (await tool('get_view_state', { viewId: view.viewId })).views[0].mapState;
    const metadata = await tool('update_trip', { tripId: created.tripId, expectedRevision: current.revision, requestId: crypto.randomUUID(), patch: { name: 'Agent 更新已同步' } });
    assert.equal(metadata.presentation.status, 'completed');
    await until(() => evaluate('document.querySelector(".topbar-title h1")?.textContent === "Agent 更新已同步"'), 'MCP change visible without refresh');
    const cameraAfter = (await tool('get_view_state', { viewId: view.viewId })).views[0].mapState;
    assert.ok(Math.abs(cameraBefore.center.lng - cameraAfter.center.lng) < 0.001, 'metadata preserves camera');
    assert.ok(Math.abs(cameraBefore.zoom - cameraAfter.zoom) < 0.01, 'metadata preserves zoom');
    const backgroundTrip = await tool('get_trip', { tripId: created.tripId });
    await tool('update_trip', { tripId: created.tripId, expectedRevision: backgroundTrip.revision, requestId: crypto.randomUUID(), presentation: { mode: 'none' }, patch: { description: 'Heartbeat fallback without SSE' } });
    await until(() => evaluate('JSON.parse(localStorage.getItem("travel-story:v1")).trips.some(t=>t.description==="Heartbeat fallback without SSE")'), 'heartbeat synchronizes without SSE');
    const updatedView = (await tool('get_view_state', { viewId: view.viewId })).views[0];
    assert.equal(updatedView.selection.stopId, edited.trip.stops[0].id);
    // The optional fixture lets us exercise a real MCP add_stop without public geocoder availability.
    if (process.env.TRAVEL_STORY_SMOKE_PROVIDER === '1') {
        const found = await tool('search_places', { query: '__TRAVEL_STORY_SMOKE_PLACE__', countryCode: 'FR', city: 'Paris' });
        assert.ok(found.candidates.length);
        const beforeAdd = await tool('get_trip', { tripId: created.tripId });
        const added = await tool('edit_itinerary', { tripId: created.tripId, expectedRevision: beforeAdd.revision, requestId: crypto.randomUUID(), operations: [{ op: 'add_stop', dayId: beforeAdd.trip.days[0].id, candidateId: found.candidates[0].candidateId }] });
        assert.equal(added.presentation.status, 'completed');
        const newId = added.results[0].stopId;
        await until(async () => { const state = (await tool('get_view_state', { viewId: view.viewId })).views[0]; return state.selection.stopId === newId; }, 'MCP add automatically focuses new point');
        assert.equal(await evaluate(`document.querySelector('[data-stop-id="${newId}"]')?.classList.contains('agent-highlight')`), true);
        assert.match(await evaluate('document.querySelector(".agent-activity")?.textContent'), /联调新增地点/);
        await delay(1800);
        const selectedAfterRoute = (await tool('get_view_state', { viewId: view.viewId })).views[0];
        assert.equal(selectedAfterRoute.selection.stopId, newId);
        assert.ok(Math.abs(selectedAfterRoute.mapState.center.lng - 2.3376) < 0.001, 'route refresh preserves the presented camera');
    }
    if(process.env.TRAVEL_STORY_SMOKE_PROVIDER==='1') {
      const found=await tool('search_places',{query:'__TRAVEL_STORY_SMOKE_PLACE__',countryCode:'FR'});
      const before=await tool('get_trip',{tripId:created.tripId});
      const mixed=await tool('edit_itinerary',{tripId:created.tripId,expectedRevision:before.revision,requestId:crypto.randomUUID(),operations:[{op:'add_stop',dayId:before.trip.days[0].id,candidateId:found.candidates[0].candidateId},{op:'add_day'}]});
      assert.equal(mixed.presentation.status,'completed');
      const day=mixed.results.at(-1).dayId;
      await until(async()=>{const state=(await tool('get_view_state',{viewId:view.viewId})).views[0];return state.selection.dayId===day&&state.selection.stopId===null;},'mixed batch presents final day target');
    }
    // Exercise fatal map state and the retry path through the real browser.
    const lost = await evaluate(`(() => {const canvas=document.querySelector('.maplibregl-canvas');const gl=canvas?.getContext('webgl2')||canvas?.getContext('webgl');const extension=gl?.getExtension('WEBGL_lose_context');if(!extension)return false;extension.loseContext();return true;})()`);
    assert.equal(lost, true, 'Software WebGL should expose context loss testing');
    await until(async () => { const r = await tool('get_view_state', { viewId: view.viewId }); return r.views[0]?.mapState?.status === 'failed'; }, 'fatal map state propagated');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('重试'))?.click()`);
    await until(async () => { const r = await tool('get_view_state', { viewId: view.viewId }); return r.views[0]?.ready; }, 'map retry recovers');
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(directory, 'browser-smoke.png'), Buffer.from(screenshot.data, 'base64'));
    const receiptDone=async(receipt)=>until(async()=>{const r=await tool('get_command',{commandId:receipt.commandId});if(['failed','expired'].includes(r.status))throw Error(JSON.stringify(r));return r.status==='completed';},'single window navigation receipt');
    await receiptDone(await tool('open_trip',{tripId:created.tripId,page:'play',viewId:view.viewId}));
    assert.equal((await tool('get_view_state',{viewId:view.viewId})).views[0].page,'play');
    await until(async()=>{const current=(await tool('get_view_state',{viewId:view.viewId})).views[0];return current.tripId===created.tripId&&current.page==='play'&&current.ready;},'playback view publishes readiness');
    if ((await tool('get_trip',{tripId:created.tripId})).trip.stops.length >= 2) {
      await receiptDone(await tool('control_view',{viewId:view.viewId,action:'play'}));
      await until(async()=>{const current=(await tool('get_view_state',{viewId:view.viewId})).views[0];return current.playback?.playing||current.playback?.ended;},'MCP actually starts playback');
      await receiptDone(await tool('control_view',{viewId:view.viewId,action:'stop'}));
      await until(async()=>!(await tool('get_view_state',{viewId:view.viewId})).views[0].playback?.playing,'MCP stops playback');
    }

    const beforePlayEdit=await tool('get_trip',{tripId:created.tripId});
    const fromPlay=await tool('update_trip',{tripId:created.tripId,expectedRevision:beforePlayEdit.revision,requestId:crypto.randomUUID(),patch:{name:'播放页回到编辑页'}});
    assert.equal(fromPlay.presentation.status,'completed');
    assert.equal((await tool('get_view_state',{viewId:view.viewId})).views[0].page,'plan');
    const openedFile=path.join(directory,'opened-url');await rm(openedFile,{force:true});
    const automatic=await tool('create_trip',{name:'单窗口新行程',startDate:'2026-11-05',endDate:'2026-11-05',requestId:crypto.randomUUID()});
    assert.equal(automatic.presentation.status,'completed');
    assert.equal(automatic.presentation.viewId,view.viewId);
    assert.equal(await evaluate('document.querySelector(".topbar-title h1")?.textContent'),'单窗口新行程');
    assert.equal((await tool('get_view_state')).views.length,1);
    if(process.env.TRAVEL_STORY_SMOKE_OPENER==='1') {
      let launched=false;try{await readFile(openedFile);launched=true;}catch{}
      assert.equal(launched,false,'existing app window never invokes OS launcher');
    }
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log(JSON.stringify({ ok: true, tripId: created.tripId, mapReady: true, checks: ['browser rendered', 'real WebGL map with empty fixture tiles', 'MCP focus acknowledged', 'manual button saved through shared API', 'MCP metadata presentation preserves camera', 'heartbeat sync without SSE', ...(process.env.TRAVEL_STORY_SMOKE_PROVIDER === '1' ? ['MCP add_stop auto-focus/card highlight/notice without extra tools','mixed batch focuses final day'] : []), 'WebGL loss reported and retry recovers', ...(process.env.TRAVEL_STORY_SMOKE_PROVIDER==='1'?['MCP play start and stop acknowledged']:[]), ...(process.env.TRAVEL_STORY_SMOKE_OPENER==='1'?['home/plan/play/new trip reuse one window without OS launch']:[]),'no runtime exceptions'], screenshot: path.join(directory, 'browser-smoke.png') }, null, 2));
}
finally {
    ws?.close();
    chrome?.kill('SIGTERM');
    await client.close();
}
