import test from 'node:test';
import assert from 'node:assert/strict';

test('business mutation sends exactly one authenticated POST and preserves explicit errors without retries', async () => {
  const { createBridgeRequest } = await import('../mcp/bridgeRequest.mjs');
  const calls = [];
  const request = createBridgeRequest({ endpoint: new URL('http://localhost:3000/api/mcp'), directory: '/unused', readToken: async () => 'secret', fetch: async (_url, init) => {
    calls.push(init);
    return { ok: false, json: async () => ({ error: { code: 'INVALID_ROUTE', message: 'Route is invalid' } }) };
  } });
  await assert.rejects(request('add_stop', { city: 'Paris' }), { code: 'INVALID_ROUTE', message: 'Route is invalid' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer secret');
});

test('missing token produces an actionable unavailable error without a network request', async () => {
  const { createBridgeRequest } = await import('../mcp/bridgeRequest.mjs');
  const request = createBridgeRequest({ endpoint: 'http://localhost:3000/api/mcp', directory: '/unused', readToken: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, fetch: async () => assert.fail('must not request') });
  await assert.rejects(request('get_status', {}), { code: 'SERVICE_UNAVAILABLE' });
});
