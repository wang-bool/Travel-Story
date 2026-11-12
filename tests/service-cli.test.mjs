import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServiceLifecycle } from '../mcp/serviceLifecycle.mjs';

async function fixture(t, fetch) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'travel-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'data'); await mkdir(directory); await writeFile(path.join(directory, 'mcp-token'), 'secret');
  return createServiceLifecycle({ root, directory, fetch, spawn: () => assert.fail('check must never spawn'), probePort: async () => false });
}

test('check offline never starts service and reports unknown stdio connection', async t => {
  const lifecycle = await fixture(t, async () => { throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }); });
  const result = await lifecycle.check();
  assert.equal(result.status, 'offline');
  assert.equal(result.stdioConnection, 'unknown');
});

test('check retains authenticated search and page summary without exposing token', async t => {
  const lifecycle = await fixture(t, async (_url, init) => ({ ok: true, json: async () => init.method === 'POST' ? { version: '0.2.0', search: { provider: 'osm', configured: true, apiKey: 'private-key' }, connectedViews: 1, views: [{ id: 'map', page: 'plan' }], capabilities: { mcp: true, manualEditing: true } } : { running: true, transport: 'stdio-bridge' } }));
  const result = await lifecycle.check();
  assert.equal(result.status, 'running');
  assert.equal(result.search.provider, 'osm');
  assert.deepEqual(result.views, [{ id: 'map', page: 'plan' }]);
  assert.equal(result.connectedViews, 1);
  assert.equal(result.stdioConnection, 'unknown');
  assert.ok(!JSON.stringify(result).includes('private-key'));
});

test('CLI check and ensure select distinct lifecycle methods and produce one JSON line', async () => {
  const { runServiceCli } = await import('../scripts/service.mjs');
  const methods = [], lines = [];
  const lifecycle = { check: async () => { methods.push('check'); return { status: 'offline', url: 'http://localhost:3000' }; }, ensure: async () => { methods.push('ensure'); return { status: 'started', url: 'http://localhost:3000' }; }, snapshot: () => ({ search: { configured: false }, views: [] }) };
  assert.equal(await runServiceCli(['check'], { lifecycle, write: line => lines.push(line) }), 1);
  assert.equal(await runServiceCli(['ensure'], { lifecycle, write: line => lines.push(line) }), 0);
  assert.deepEqual(methods, ['check', 'ensure']);
  assert.equal(lines.length, 2);
  for (const line of lines) { assert.equal(line.split('\n').length, 2); assert.equal(JSON.parse(line).stdioConnection, 'unknown'); assert.ok(JSON.parse(line).timing.elapsedMs >= 0); }
});

test('check gives each HTTP probe a bounded signal and never waits the startup timeout', async t => {
  const signals = [];
  const lifecycle = await fixture(t, async (_url, init) => {
    signals.push(init.signal);
    throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
  });
  const started = Date.now();
  await lifecycle.check();
  assert.equal(signals.length, 1);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.ok(Date.now() - started < 2500);
});

test('CLI can be invoked from another cwd and emits JSON errors without URL credentials', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('../scripts/service.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [script, 'check'], { cwd: os.tmpdir(), env: { ...process.env, TRAVEL_STORY_URL: 'http://user:private-token@localhost:3000' }, encoding: 'utf8' });
  assert.equal(child.status, 1);
  const body = JSON.parse(child.stdout);
  assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(body.stdioConnection, 'unknown');
  assert.ok(!child.stdout.includes('private-token'));
});
