#!/usr/bin/env node
// One client-owned command starts the MCP stdio server and ensures the web app.
import { startBridge } from './index.mjs';
await startBridge({ autoStart: true });
