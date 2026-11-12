#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServiceLifecycle } from './serviceLifecycle.mjs';
import { createBridgeRequest } from './bridgeRequest.mjs';
import { createBridgeRuntime } from './bridgeRuntime.mjs';
import { createMcpServer } from './server.mjs';

export async function startBridge({ autoStart = false } = {}) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const configured = new URL(process.env.TRAVEL_STORY_URL || 'http://localhost:3000');
    const directory = process.env.TRAVEL_STORY_DATA_DIR || path.join(root, 'data');
    // Lifecycle construction validates the local origin and absolute paths before use.
    const lifecycle = createServiceLifecycle({ root, base: configured.href, directory });
    const endpoint = new URL('/api/mcp', configured);
    const request = createBridgeRequest({ endpoint, directory });
    const runtime = createBridgeRuntime({
        lifecycle, request, autoStart,
        onStartup: result => { if (autoStart) process.stderr.write(`[travel-story] App ${result.status}: ${result.url}${result.pid ? ` (pid=${result.pid})` : ''}; MCP stdio connected\n`); },
        onStartupError: error => process.stderr.write(`[travel-story] App startup failed: ${error.message}\n`),
    });
    const server = createMcpServer((name, args) => runtime.call(name, args));
    await server.connect(new StdioServerTransport());
    // Initialize/tool discovery remains available while the app starts. Business calls wait.
    void runtime.start();
    process.on('SIGINT', () => { void server.close(); });
    process.on('SIGTERM', () => { void server.close(); });
    return server;
}

// Legacy entry remains lazy for clients that explicitly manage the app lifecycle.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await startBridge();
