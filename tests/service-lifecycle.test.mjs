import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const health = { running: true, transport: 'stdio-bridge' };
const status = { version: '0.2.0', capabilities: { mcp: true, manualEditing: true } };
const response = (body, code = 200) => ({ ok: code === 200, status: code, json: async () => body });
async function fixture(t, overrides = {}) {
  const { createServiceLifecycle } = await import('../mcp/serviceLifecycle.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'travel-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'data');
  await mkdir(directory);
  await writeFile(path.join(directory, 'mcp-token'), 'secret');
  let now = 0, online = false;
  const calls = [], children = [];
  const options = {
    root, directory, base: 'http://127.0.0.1:3456', env: {}, timeoutMs: 30, pollMs: 10,
    clock: () => now, sleep: async ms => { now += ms; }, access: async () => {},
    probePort: async () => online,
    fetch: async (_url, init = {}) => {
      if (!online) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      if (init.method === 'POST') {
        assert.equal(init.headers.Authorization, 'Bearer secret');
        assert.deepEqual(JSON.parse(init.body), { name: 'get_status', arguments: {} });
      }
      return response(init.method === 'POST' ? status : health);
    },
    spawn: (...args) => {
      calls.push(args);
      const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null, unref() {} });
      children.push(child);
      online = true;
      return child;
    }, ...overrides,
  };
  return { lifecycle: createServiceLifecycle(options), options, root, directory, calls, children, setOnline: value => { online = value; } };
}

test('offline service starts Next on the exact port and authenticates readiness', async t => {
  const f = await fixture(t);
  const result = await f.lifecycle.ensure();
  assert.equal(result.status, 'started');
  assert.equal(result.launched, true);
  assert.equal(result.url, 'http://127.0.0.1:3456');
  assert.equal(result.pid, 123);
  const [command, args, options] = f.calls[0];
  assert.equal(command, process.execPath);
  assert.deepEqual(args, [path.join(f.root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3456']);
  assert.equal(options.cwd, f.root);
  assert.equal(options.detached, true);
  assert.equal(options.env.TRAVEL_STORY_DATA_DIR, f.directory);
  assert.equal(options.stdio[0], 'ignore');
  assert.equal(options.stdio[1], options.stdio[2]);
  assert.equal((await stat(result.logPath)).mode & 0o777, 0o600);
});

test('existing authenticated service is reused without spawning', async t => {
  const f = await fixture(t); f.setOnline(true);
  assert.deepEqual(await f.lifecycle.ensure(), { status: 'running', url: 'http://127.0.0.1:3456', launched: false });
  assert.equal(f.calls.length, 0);
});

test('a subsequent ensure reuses our ready service without reporting a new launch', async t => {
  const f = await fixture(t);
  assert.equal((await f.lifecycle.ensure()).status, 'started');
  assert.deepEqual(await f.lifecycle.ensure(), { status: 'running', url: 'http://127.0.0.1:3456', launched: false });
  assert.equal(f.calls.length, 1);
});

test('a single ensure replaces our exited service when it is offline', async t => {
  const f = await fixture(t);
  await f.lifecycle.ensure();
  f.children[0].exitCode = 1;
  f.children[0].emit('exit', 1, null);
  f.setOnline(false);
  const result = await f.lifecycle.ensure();
  assert.equal(result.status, 'started');
  assert.equal(result.launched, true);
  assert.equal(f.calls.length, 2);
});

test('concurrent ensure calls share one launch', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.lifecycle.ensure(), f.lifecycle.ensure(), f.lifecycle.ensure()]);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(results[0], results[2]);
});

test('responding unrelated service never causes a launch', async t => {
  const f = await fixture(t, { fetch: async () => response({ service: 'other' }) });
  await assert.rejects(f.lifecycle.ensure(), /Travel Story|identity/);
  assert.equal(f.calls.length, 0);
});

test('wrong data directory or token fails without starting another server', async t => {
  const f = await fixture(t, { fetch: async (_url, init) => response(init?.method === 'POST' ? { error: { code: 'ACCESS_DENIED' } } : health, init?.method === 'POST' ? 403 : 200) });
  await assert.rejects(f.lifecycle.ensure(), /token|directory|authenticat/i);
  assert.equal(f.calls.length, 0);
});

test('missing token in the configured directory cannot reuse a different service', async t => {
  const f = await fixture(t); f.setOnline(true);
  await rm(path.join(f.directory, 'mcp-token'));
  await assert.rejects(f.lifecycle.ensure(), /token.*TRAVEL_STORY_DATA_DIR/);
  assert.equal(f.calls.length, 0);
});

test('authenticated status must still identify the Travel Story API', async t => {
  const f = await fixture(t, { fetch: async (_url, init) => response(init?.method === 'POST' ? { version: '1' } : health) });
  await assert.rejects(f.lifecycle.ensure(), /identity/);
  assert.equal(f.calls.length, 0);
});

test('a listening TCP port with failed HTTP probe is not treated as offline', async t => {
  const f = await fixture(t, { probePort: async () => true });
  await assert.rejects(f.lifecycle.ensure(), /port|respond/i);
  assert.equal(f.calls.length, 0);
});

test('missing Next dependencies gives a diagnostic without install or spawn', async t => {
  const f = await fixture(t, { access: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
  await assert.rejects(f.lifecycle.ensure(), /dependencies|Next/i);
  assert.equal(f.calls.length, 0);
});

test('missing configured BUILD_ID selects dev and forwards dist directory', async t => {
  const f = await fixture(t, { env: { TRAVEL_STORY_DIST_DIR: '.next-test' }, access: async target => { if (target.endsWith('BUILD_ID')) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
  await f.lifecycle.ensure();
  assert.equal(f.calls[0][1][1], 'dev');
  assert.equal(f.calls[0][2].env.TRAVEL_STORY_DIST_DIR, '.next-test');
});

test('spawn errors are reported with the service log path', async t => {
  const child = Object.assign(new EventEmitter(), { unref() {} });
  const f = await fixture(t, { spawn: () => { queueMicrotask(() => child.emit('error', new Error('spawn denied'))); return child; } });
  await assert.rejects(f.lifecycle.ensure(), /spawn denied.*service.log/);
});

test('exited child fails startup once no correct service is listening', async t => {
  const f = await fixture(t, { spawn: () => Object.assign(new EventEmitter(), { exitCode: 1, pid: 44, unref() {} }) });
  await assert.rejects(f.lifecycle.ensure(), /exit.*1.*service.log/i);
});

test('a competing correct service can become ready after our child exits', async t => {
  let checks = 0;
  const f = await fixture(t, {
    probePort: async () => checks > 1,
    fetch: async (_url, init) => {
      if (++checks < 4) throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
      return response(init?.method === 'POST' ? status : health);
    },
    spawn: (...args) => { f.calls.push(args); return Object.assign(new EventEmitter(), { pid: 99, exitCode: 1, unref() {} }); },
  });
  const result = await f.lifecycle.ensure();
  assert.equal(result.status, 'running');
  assert.equal(result.launched, false);
  assert.equal(result.pid, undefined);
  assert.equal(f.calls.length, 1);
});

test('timeout preserves the live launch and retry waits without duplicate spawn', async t => {
  let child;
  const f = await fixture(t, { spawn: (...args) => { f.calls.push(args); child = Object.assign(new EventEmitter(), { pid: 55, exitCode: null, signalCode: null, unref() {} }); return child; } });
  await assert.rejects(f.lifecycle.ensure(), /timed out.*service.log/i);
  await assert.rejects(f.lifecycle.ensure(), /timed out/i);
  assert.equal(f.calls.length, 1);
  f.setOnline(true);
  assert.equal((await f.lifecycle.ensure()).status, 'running');
});

test('rejects remote or non-origin service targets before probing', async t => {
  const { createServiceLifecycle } = await import('../mcp/serviceLifecycle.mjs');
  for (const base of ['http://example.org', 'https://localhost:3000', 'http://u:p@localhost', 'http://localhost/api', 'http://localhost/?x=1']) {
    assert.throws(() => createServiceLifecycle({ root: '/app', directory: '/data', base }), /local HTTP origin/i);
  }
});
