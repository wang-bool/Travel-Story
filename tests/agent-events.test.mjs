import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
// Resolve Next's source aliases while exercising the actual route in Node.
registerHooks({resolve(specifier,context,next){
 if(specifier.startsWith('@/')) return next(new URL(`../${specifier.slice(2)}.ts`,import.meta.url).href,context);
 return next(specifier,context);
}});
const {GET}=await import('../app/api/agent-events/route.ts');
const {getAgentActivityStore}=await import('../lib/server/agentActivity.ts');
const request=(query,signal)=>new Request(`http://localhost/api/agent-events${query}`,{headers:{host:'localhost'},signal});
test('agent SSE requires a valid explicit view and restricts local access',async()=>{
 for(const query of ['', '?viewId=', '?viewId=../other', '?viewId=*']) assert.equal((await GET(request(query))).status,400);
 const response=await GET(new Request('http://evil.test/api/agent-events?viewId=a',{headers:{host:'evil.test'}}));
 assert.equal(response.status,403);
});
test('agent SSE immediately restores only the selected view and streams its updates',async()=>{
 const store=getAgentActivityStore();const first=store.start({viewId:'stream-a',kind:'search',title:'a'});
 store.start({viewId:'stream-b',kind:'search',title:'b'});
 const abort=new AbortController();const response=await GET(request('?viewId=stream-a',abort.signal));
 const reader=response.body.getReader();const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes).slice(6).trim());
 try {
  const snapshot=decode((await reader.read()).value);assert.equal(snapshot.type,'snapshot');assert.deepEqual(snapshot.activities.map(a=>a.id),[first]);
  store.update(first,{status:'completed'});assert.equal(decode((await reader.read()).value).activities[0].status,'completed');
 }finally {abort.abort();await reader.cancel();}
 const reconnect=await GET(request('?viewId=stream-a'));const again=reconnect.body.getReader();
 try{assert.equal(decode((await again.read()).value).activities[0].status,'completed');}finally{await again.cancel();}
});
