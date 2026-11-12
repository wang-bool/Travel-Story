import { assertLocalRequest, errorResponse } from '../../../lib/server/localAccess.ts';
import { getTravelService } from '../../../lib/server/travelService.ts';
import { getViewRegistry, ViewError, type ViewState } from '../../../lib/server/viewRegistry.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await assertLocalRequest(request);
    if (Number(request.headers.get('content-length')) > 32768) throw new ViewError('INVALID_ARGUMENT');
    const text = await request.text();
    if (text.length > 32768) throw new ViewError('INVALID_ARGUMENT');
    let input;
    try { input = JSON.parse(text); } catch { throw new ViewError('INVALID_ARGUMENT'); }
    if (!input || typeof input !== 'object') throw new ViewError('INVALID_ARGUMENT');
    const registry = getViewRegistry();
    if (input.op === 'remove') {
      if (typeof input.viewId !== 'string') throw new ViewError('INVALID_ARGUMENT');
      registry.remove(input.viewId);
      return Response.json({ ok: true });
    }
    if (input.op === 'ack') {
      if (typeof input.viewId !== 'string' || typeof input.commandId !== 'string') throw new ViewError('INVALID_ARGUMENT');
      return Response.json({ command: registry.acknowledge(input.viewId, input.commandId, input.status, input.error) });
    }
    if (input.op !== 'heartbeat') throw new ViewError('INVALID_ARGUMENT');
    const view = registry.heartbeat(input.view as ViewState);
    let tripRevision: number | null = null;
    try { if (view.tripId) tripRevision = (await getTravelService().execute('get_trip',{tripId:view.tripId})).revision; }
    catch(error) { if((error as {code?:string}).code!=='TRIP_NOT_FOUND')throw error; }
    return Response.json({ view, commands: registry.pending(view.viewId), tripRevision });
  } catch (error) { return errorResponse(error); }
}
