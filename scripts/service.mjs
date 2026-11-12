#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServiceLifecycle } from '../mcp/serviceLifecycle.mjs';

export async function runServiceCli(args = process.argv.slice(2), { lifecycle, write = line => process.stdout.write(line), clock = Date.now, env = process.env } = {}) {
  const started = clock();
  let url;
  const emit = result => write(`${JSON.stringify({ ...result, stdioConnection: 'unknown', timing: { elapsedMs: Math.max(0, clock() - started) } })}\n`);
  try {
    if (args.length !== 1 || !['check', 'ensure'].includes(args[0])) {
      emit({ status: 'error', error: { code: 'INVALID_ARGUMENT', message: 'Usage: node scripts/service.mjs check|ensure' } });
      return 2;
    }
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    url = env.TRAVEL_STORY_URL || 'http://localhost:3000';
    lifecycle ??= createServiceLifecycle({ root, base: url, directory: env.TRAVEL_STORY_DATA_DIR || path.join(root, 'data'), env });
    const result = await lifecycle[args[0]]();
    emit({ ...(lifecycle.snapshot?.() || {}), ...result });
    return ['running', 'started'].includes(result.status) ? 0 : 1;
  } catch (error) {
    emit({ status: 'error', ...(url && !/@/.test(url) ? { url } : {}), search: null, connectedViews: null, views: [], error: { code: error.code || 'SERVICE_UNAVAILABLE', message: error.message } });
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runServiceCli();
