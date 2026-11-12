// Diagnose navigation with real Chrome; use only a separately started disposable server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = process.env.TRAVEL_STORY_DATA_DIR;
assert.ok(directory?.startsWith('/tmp/travel-story-mcp.'), 'Use disposable data');
const base = process.env.TRAVEL_STORY_URL || 'http://127.0.0.1:3132';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../mcp/index.mjs', import.meta.url))],
  env: { ...process.env, TRAVEL_STORY_URL: base }, stderr: 'inherit' });
const client = new Client({ name: 'navigation-smoke', version: '1' });
const tool = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, JSON.stringify(response.content));
  return response.structuredContent;
};
let chrome, ws, stage = 'setup', tripId, holdHomeRsc = false, heldRsc;
const requests = new Map(), failures = [], documents = [], exceptions = [], consoleErrors = [], snapshots = [];
const pending = new Map();
let sequence = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
  pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const report = () => ({ base, tripId, stage, documents, failures, exceptions, consoleErrors, snapshots });
try {
  await client.connect(transport);
  const created = await tool('create_trip', { presentation: { mode: 'none' }, name: 'Navigation smoke only',
    startDate: '2026-11-01', endDate: '2026-11-01', requestId: crypto.randomUUID() });
  tripId = created.tripId;
  const profile = path.join(directory, `navigation-chrome-${Date.now()}`);
  await mkdir(profile);
  chrome = spawn(process.env.CHROME_PATH || 'google-chrome', ['--headless=new', '--no-sandbox',
    '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => { try { return Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { return false; } }, 'Chrome debug port');
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(String(event.data)), data = message.params;
    if (message.id) {
      const entry = pending.get(message.id);
      if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
    } else if (message.method === 'Network.requestWillBeSent') {
      requests.set(data.requestId, { stage, url: data.request.url, type: data.type,
        rsc: new URL(data.request.url).searchParams.has('_rsc'), prefetch: data.request.headers['Next-Router-Prefetch'] });
    } else if (message.method === 'Network.loadingFailed') {
      failures.push({ ...requests.get(data.requestId), errorText: data.errorText, canceled: data.canceled === true });
    } else if (message.method === 'Network.responseReceived' && data.type === 'Document') {
      documents.push({ stage, url: data.response.url, status: data.response.status });
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.push({ stage, details: data.exceptionDetails });
    else if (message.method === 'Runtime.consoleAPICalled' && data.type === 'error') consoleErrors.push({ stage, args: data.args.map(arg => arg.value ?? arg.description) });
    else if (message.method === 'Fetch.requestPaused') {
      const url = new URL(data.request.url);
      if (holdHomeRsc && url.pathname === '/' && url.searchParams.has('_rsc')) { heldRsc = data; return; }
      if (url.pathname.startsWith('/api/tiles/')) {
        const planet = url.pathname === '/api/tiles/planet';
        const body = planet ? JSON.stringify({ tilejson: '3.0.0', tiles: [`${base}/api/tiles/smoke/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 0, vector_layers: [] }) : '';
        void call('Fetch.fulfillRequest', { requestId: data.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: planet ? 'application/json' : 'application/x-protobuf' }], body: Buffer.from(body).toString('base64') }).catch(() => {});
      } else void call('Fetch.continueRequest', { requestId: data.requestId }).catch(() => {});
    }
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Fetch.enable', { patterns: [{ urlPattern: '*/api/tiles/*' }, { urlPattern: '*_rsc=*' }] });
  const homeReady = () => until(() => evaluate('location.pathname === "/" && !!document.querySelector(".hero-stage") && !!document.querySelector(".trip-card")'), 'homepage DOM and loaded trips');
  const planReady = () => until(() => evaluate(`location.pathname === "/trip/${tripId}" && !!document.querySelector(".plan .add-day-btn") && !!document.querySelector(".topbar-back")`), 'plan DOM and back link');
  const homeView = () => until(async () => (await tool('get_view_state')).views.find(view => view.page === 'home' && view.ready), 'homepage bridge');
  const clickHome = () => evaluate('document.querySelector(".topbar-back").click()');
  stage = 'document-open';
  const opened = await call('Page.navigate', { url: base });
  assert.ok(!opened.errorText, JSON.stringify(opened));
  await homeReady();
  stage = 'link-to-plan';
  await evaluate(`document.querySelector('a[href="/trip/${tripId}"]').click()`);
  await planReady();
  stage = 'link-to-home'; await clickHome(); await homeReady();
  const view = await homeView();
  stage = 'agent-navigation';
  const receipt = await tool('open_trip', { tripId, viewId: view.viewId });
  assert.equal(receipt.reused, true);
  await until(async () => {
    const command = await tool('get_command', { commandId: receipt.commandId });
    assert.ok(!['failed', 'expired'].includes(command.status), JSON.stringify(command));
    return command.status === 'completed';
  }, 'agent navigation completed');
  await planReady();
  assert.equal((await tool('get_view_state', { viewId: view.viewId })).views[0].viewId, view.viewId);
  // Chrome may report cancellation of an RSC stream while the destination still
  // renders. Preserve that evidence; only accept it alongside the checks above.
  assert.equal(failures.filter(f => f.type === 'Document' || (f.rsc && !f.canceled)).length, 0, 'No failed Document or non-canceled RSC requests');
  assert.equal(consoleErrors.filter(e => e.args.some(arg => String(arg).includes('Failed to fetch RSC payload'))).length, 0, 'No RSC fallback errors');
  const normal = { destinationRendered: true, agentReceiptCompleted: true,
    canceledRsc: failures.filter(f => f.rsc && f.canceled), documentFailures: failures.filter(f => f.type === 'Document') };

  // Force an in-flight RSC during a hard navigation. This is an injected timing scenario,
  // not a reproduction of an unexplained user failure. The final Document must still render.
  stage = 'injected-rsc-cancellation'; holdHomeRsc = true;
  // A fresh Document clears the router cache populated by the preceding home visit.
  const fresh = await call('Page.navigate', { url: `${base}/trip/${tripId}?navigationSmoke=1` });
  assert.ok(!fresh.errorText, JSON.stringify(fresh));
  await planReady();
  await clickHome();
  await until(() => heldRsc, 'held RSC request');
  const reloaded = await call('Page.navigate', { url: `${base}/?navigationSmokeReload=1` });
  assert.ok(!reloaded.errorText, JSON.stringify(reloaded));
  holdHomeRsc = false;
  await homeReady(); await homeView();
  await until(() => failures.find(f => f.stage === stage && f.rsc && f.canceled), 'canceled RSC evidence');
  assert.equal(failures.filter(f => f.type === 'Document').length, 0, 'No failed Document navigation');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(JSON.stringify({ ok: true, normal, injectedCancellationObserved: true,
    documents, rscFailures: failures.filter(f => f.rsc), runtimeExceptions: exceptions.length,
    consoleErrorCount: consoleErrors.length, evidence: path.join(directory, 'navigation-smoke.json') }, null, 2));
} finally {
  if (ws?.readyState === WebSocket.OPEN) {
    try { snapshots.push({ stage, ...await evaluate('({url:location.href, title:document.title, body:document.body.innerText.slice(0,2000), anchors:[...document.querySelectorAll("a")].map(a=>({href:a.getAttribute("href"),className:a.className}))})') }); } catch {}
  }
  await writeFile(path.join(directory, 'navigation-smoke.json'), JSON.stringify(report(), null, 2));
  ws?.close(); chrome?.kill('SIGTERM'); await client.close();
}
