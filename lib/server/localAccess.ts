import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { TravelError, check } from '../domain/itinerary.ts';
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
export async function bridgeToken() {
    const directory = process.env.TRAVEL_STORY_DATA_DIR || path.join(process.cwd(), 'data');
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'mcp-token');
    try {
        await fs.writeFile(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
            throw e;
    }
    return (await fs.readFile(file, 'utf8')).trim();
}
export async function assertLocalRequest(req: Request, options: {
    mcp?: boolean;
} = {}) {
    let host: URL;
    try {
        host = new URL(`http://${req.headers.get('host') || ''}`);
    }
    catch {
        throw new TravelError('ACCESS_DENIED', 'Invalid Host');
    }
    check(localHosts.has(host.hostname), 'ACCESS_DENIED', 'Local connections only');
    const origin = req.headers.get('origin');
    if (origin) {
        let parsed: URL;
        try {
            parsed = new URL(origin);
        }
        catch {
            throw new TravelError('ACCESS_DENIED', 'Invalid Origin');
        }
        check(parsed.host === host.host && ['http:', 'https:'].includes(parsed.protocol), 'ACCESS_DENIED', 'Cross-origin access denied');
    }
    if (options.mcp) {
        const expected = Buffer.from(`Bearer ${await bridgeToken()}`), actual = Buffer.from(req.headers.get('authorization') || '');
        check(actual.length === expected.length && timingSafeEqual(actual, expected), 'ACCESS_DENIED', 'MCP bridge token required');
    }
}
export function errorResponse(error: unknown) { const e = error as {
    code?: string;
    message?: string;
}; const code = e.code ?? 'INTERNAL_ERROR'; const status = code === 'ACCESS_DENIED' ? 403 : code === 'REVISION_CONFLICT' || code === 'IMPORT_CONFLICT' ? 409 : code.endsWith('NOT_FOUND') ? 404 : code === 'STORAGE_CORRUPT' || code === 'INTERNAL_ERROR' ? 500 : 400; return Response.json({ error: { code, message: e.message ?? 'Request failed' } }, { status }); }
