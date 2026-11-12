import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Send each business operation once. A lost mutation response must never be replayed. */
export function createBridgeRequest({ endpoint, directory, fetch: request = globalThis.fetch,
    readToken = async () => (await readFile(path.join(directory, 'mcp-token'), 'utf8')).trim() }) {
    return async (name, args) => {
        try {
            const token = await readToken();
            if (!token) throw new Error('Empty token');
            const response = await request(endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ name, arguments: args }), signal: AbortSignal.timeout(360000),
            });
            const body = await response.json();
            if (!response.ok) throw Object.assign(new Error(body.error?.message || 'Local request failed'), { code: body.error?.code || 'SERVICE_UNAVAILABLE' });
            return body;
        } catch (error) {
            if (error.code && error.code !== 'ENOENT') throw error;
            throw Object.assign(new Error('Call ensure_service to start the local application. Check TRAVEL_STORY_URL and TRAVEL_STORY_DATA_DIR if using a custom port or data directory. A lost response is not retried; inspect current state before repeating a mutation.'), { code: 'SERVICE_UNAVAILABLE' });
        }
    };
}
