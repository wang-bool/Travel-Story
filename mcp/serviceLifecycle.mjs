import { access as fsAccess, mkdir, open, readFile } from 'node:fs/promises';
import { spawn as nodeSpawn } from 'node:child_process';
import { connect } from 'node:net';
import path from 'node:path';

const failure = message => Object.assign(new Error(message), { code: 'SERVICE_UNAVAILABLE' });
function refused(error) {
  return error?.code === 'ECONNREFUSED' || refusedCause(error?.cause) ||
    (Array.isArray(error?.errors) && error.errors.length > 0 && error.errors.every(refused));
}
function refusedCause(cause) { return cause ? refused(cause) : false; }
function portListening(host, port, timeout) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const finish = (error, value) => { socket.destroy(); error ? reject(error) : resolve(value); };
    socket.once('connect', () => finish(null, true));
    socket.once('error', error => finish(refused(error) ? null : error, false));
    socket.setTimeout(timeout, () => finish(failure('Local port probe timed out'), false));
  });
}

/** A bridge-owned lifecycle. Inputs are local configuration, never MCP tool arguments. */
export function createServiceLifecycle({
  root, base = 'http://localhost:3000', directory = path.join(root, 'data'),
  fetch: request = globalThis.fetch, probePort = portListening, spawn = nodeSpawn,
  clock = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  access = fsAccess, env = process.env, timeoutMs = 45000, pollMs = 250,
}) {
  let origin;
  try { origin = new URL(base); } catch { throw failure('Service URL must be a local HTTP origin'); }
  if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw failure('Service URL must be a local HTTP origin');
  if (!path.isAbsolute(root) || !path.isAbsolute(directory)) throw failure('Application root and data directory must be absolute');
  const url = origin.origin, endpoint = new URL('/api/mcp', origin);
  const host = origin.hostname === '[::1]' ? '::1' : origin.hostname;
  const bindHost = host === '::1' ? '::1' : '127.0.0.1';
  const port = Number(origin.port || 80), logPath = path.join(directory, 'service.log');
  const timeout = Math.min(45000, Math.max(1, timeoutMs));
  let pending, launch, latest;

  function snapshot() {
    const search = latest?.search;
    return {
      stdioConnection: 'unknown',
      search: search ? {
        ...(typeof search.configured === 'boolean' ? { configured: search.configured } : {}),
        ...(typeof search.provider === 'string' ? { provider: search.provider } : {}),
        ...(search.providers && typeof search.providers === 'object' ? { providers: Object.fromEntries(Object.entries(search.providers).filter(([, value]) => typeof value === 'boolean')) } : {}),
      } : null,
      connectedViews: Number.isInteger(latest?.connectedViews) ? latest.connectedViews : null,
      views: Array.isArray(latest?.views) ? latest.views.map(view => Object.fromEntries(
        ['id', 'viewId', 'tripId', 'page', 'ready', 'host', 'appBridge', 'visibility', 'focused', 'lastSeen'].filter(key => view[key] !== undefined).map(key => [key, view[key]])
      )) : [],
    };
  }

  async function inspect(deadline, starting = false) {
    const signal = () => AbortSignal.timeout(Math.max(1, Math.min(1500, deadline - clock())));
    let response;
    try { response = await request(endpoint, { signal: signal() }); }
    catch (error) {
      if (starting) return false;
      const listening = await probePort(host, port, Math.max(1, Math.min(1000, deadline - clock())));
      if (!listening && refused(error)) return false;
      throw failure(`Local port ${port} is occupied or did not respond as Travel Story; check TRAVEL_STORY_URL`);
    }
    if (!response.ok) {
      if (starting) return false;
      throw failure(`Local port ${port} did not respond as Travel Story (HTTP ${response.status})`);
    }
    let health;
    try { health = await response.json(); } catch (error) { throw failure(`Local port ${port} has an unrecognized Travel Story identity (${error.name || 'invalid JSON'})`); }
    if (health?.running !== true || health?.transport !== 'stdio-bridge')
      throw failure(`Local port ${port} is not a Travel Story service`);
    let token;
    try { token = (await readFile(path.join(directory, 'mcp-token'), 'utf8')).trim(); }
    catch { throw failure(`Cannot read Travel Story token in ${directory}; check TRAVEL_STORY_DATA_DIR`); }
    if (!token) throw failure(`Empty Travel Story token in ${directory}`);
    let authenticated, status;
    try {
      authenticated = await request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'get_status', arguments: {} }), signal: signal(),
      });
      status = await authenticated.json();
    } catch {
      if (starting) return false;
      throw failure('Cannot authenticate Travel Story; check the configured URL and data directory');
    }
    if (!authenticated.ok) throw failure(`Travel Story token authentication failed; check data directory ${directory}`);
    if (typeof status?.version !== 'string' || status?.capabilities?.mcp !== true || status?.capabilities?.manualEditing !== true)
      throw failure('Authenticated service does not have the Travel Story identity');
    latest = status;
    return true;
  }

  function result(started) {
    const alive = launch && !launch.error && !launch.exited && launch.child.exitCode == null && launch.child.signalCode == null;
    return started && alive
      ? { status: 'started', url, launched: true, ...(launch.child.pid ? { pid: launch.child.pid } : {}), logPath }
      : { status: 'running', url, launched: false };
  }

  async function start() {
    const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
    try { await access(next); } catch { throw failure(`Next dependencies are missing at ${next}; install project dependencies before starting Travel Story`); }
    const dist = path.resolve(root, env.TRAVEL_STORY_DIST_DIR || '.next');
    let mode = 'start';
    try { await access(path.join(dist, 'BUILD_ID')); } catch (error) {
      if (error.code !== 'ENOENT') throw failure(`Cannot inspect Next build: ${error.message}`);
      mode = 'dev';
    }
    await mkdir(directory, { recursive: true });
    const log = await open(logPath, 'a', 0o600);
    try {
      await log.chmod(0o600);
      const child = spawn(process.execPath, [next, mode, '--hostname', bindHost, '--port', String(port)], {
        cwd: root, env: { ...env, TRAVEL_STORY_DATA_DIR: directory }, detached: true,
        stdio: ['ignore', log.fd, log.fd],
      });
      launch = { child, error: null, exited: false, exitCode: null };
      const current = launch;
      child.once('error', error => { current.error = error; });
      child.once('exit', (code, signal) => { current.exited = true; current.exitCode = code ?? signal; });
      child.unref();
    } catch (error) { throw failure(`Travel Story spawn failed: ${error.message}; log: ${logPath}`); }
    finally { await log.close(); }
  }

  async function run() {
    const deadline = clock() + timeout;
    if (await inspect(deadline, !!launch)) return result(false);
    // An exited launch from an earlier call should not consume a recovery attempt.
    // Keep it while the port is occupied so a competing startup can finish.
    if (launch && (launch.error || launch.exited || launch.child.exitCode != null || launch.child.signalCode != null) &&
        !await probePort(host, port, Math.max(1, Math.min(1000, deadline - clock())))) launch = undefined;
    const launchedThisCall = !launch;
    if (launchedThisCall) await start();
    while (clock() < deadline) {
      // Readiness wins if another bridge successfully started this exact service.
      if (await inspect(deadline, true)) return result(launchedThisCall);
      if (launch.error) {
        const error = launch.error; launch = undefined;
        throw failure(`Travel Story spawn failed: ${error.message}; log: ${logPath}`);
      }
      if (launch.exited || launch.child.exitCode != null || launch.child.signalCode != null) {
        if (!await probePort(host, port, Math.max(1, Math.min(1000, deadline - clock())))) {
          const code = launch.exitCode ?? launch.child.exitCode ?? launch.child.signalCode; launch = undefined;
          throw failure(`Travel Story exited before readiness (${code}); log: ${logPath}`);
        }
      }
      await sleep(Math.min(pollMs, Math.max(1, deadline - clock())));
    }
    throw failure(`Travel Story startup timed out; retry ensure_service to check the same process; log: ${logPath}`);
  }
  return {
    snapshot,
    async check() {
      latest = undefined;
      const online = await inspect(clock() + Math.min(timeout, 2500), !!launch);
      return { status: online ? 'running' : launch && !launch.exited && !launch.error ? 'starting' : 'offline', url, launched: false, ...snapshot() };
    },
    ensure() {
      if (!pending) pending = run().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
