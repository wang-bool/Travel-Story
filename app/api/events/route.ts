import { getTravelService } from '@/lib/server/travelService';
import { assertLocalRequest, errorResponse } from '@/lib/server/localAccess';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(req:Request){
  try{await assertLocalRequest(req);}catch(e){return errorResponse(e);}
  let clean=()=>{};
  const stream=new ReadableStream({start(controller){
    const encoder=new TextEncoder();let closed=false;
    const send=()=>{if(!closed)controller.enqueue(encoder.encode('data: {"type":"changed"}\n\n'));};
    const off=getTravelService().onChange(send);
    const timer=setInterval(()=>{if(!closed)controller.enqueue(encoder.encode(': heartbeat\n\n'));},15000);
    clean=()=>{if(closed)return;closed=true;off();clearInterval(timer);req.signal.removeEventListener('abort',clean);try{controller.close();}catch{}};
    req.signal.addEventListener('abort',clean,{once:true});send();if(req.signal.aborted)clean();
  },cancel(){clean();}});
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'}});
}
