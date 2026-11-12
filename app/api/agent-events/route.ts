import { getAgentActivityStore, validActivityViewId } from '@/lib/server/agentActivity';
import { assertLocalRequest, errorResponse } from '@/lib/server/localAccess';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: Request) {
 try { await assertLocalRequest(req); } catch (error) { return errorResponse(error); }
 const viewId = new URL(req.url).searchParams.get('viewId');
 if (!validActivityViewId(viewId)) return Response.json({error: {code: 'INVALID_ARGUMENT', message: '有效的 viewId 为必填项'}}, {status: 400});
 let clean = () => {};
 const stream = new ReadableStream({start(controller) {
  const store = getAgentActivityStore(), encoder = new TextEncoder();let closed = false;
  const send = () => {if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'snapshot', activities: store.list(viewId)})}\n\n`));};
  const off = store.subscribe(viewId, send);
  const timer = setInterval(() => {if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n'));}, 15000);
  clean = () => {if (closed) return;closed = true;off();clearInterval(timer);req.signal.removeEventListener('abort',clean);try {controller.close();} catch {}};
  req.signal.addEventListener('abort',clean,{once: true});send();if (req.signal.aborted) clean();
 },cancel() {clean();}});
 return new Response(stream,{headers: {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'}});
}
