import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeRuntime } from '../mcp/bridgeRuntime.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((r,j) => { resolve=r; reject=j; }); return {promise,resolve,reject}; };

test('unified startup begins the app without a tool call and gates service requests until authenticated readiness', async () => {
  const boot=deferred(), events=[];
  const runtime=createBridgeRuntime({autoStart:true,lifecycle:{ensure:()=>{events.push('ensure');return boot.promise;}},request:async(name,args)=>{events.push(name);return {name,args};}});
  runtime.start();
  const call=runtime.call('get_status',{});
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(events,['ensure']);
  boot.resolve({status:'started',url:'http://localhost:3000',launched:true});
  assert.equal((await call).name,'get_status');
  assert.deepEqual(events,['ensure','get_status']);
});

test('startup and concurrent ensure tools share one launch, returning the real service address', async()=>{
  const boot=deferred();let starts=0;
  const runtime=createBridgeRuntime({autoStart:true,lifecycle:{ensure:()=>{starts++;return boot.promise;}},request:async()=>({})});
  runtime.start();const a=runtime.call('ensure_service',{}),b=runtime.call('get_status',{});
  boot.resolve({status:'running',url:'http://127.0.0.1:3132',launched:false});
  assert.equal((await a).url,'http://127.0.0.1:3132');await b;assert.equal(starts,1);
});

test('startup failure is observable without an unhandled rejection; explicit ensure can recover',async()=>{
  let attempts=0,requests=0;const logs=[];
  const runtime=createBridgeRuntime({autoStart:true,lifecycle:{ensure:async()=>{if(++attempts===1)throw Object.assign(new Error('port occupied'),{code:'SERVICE_UNAVAILABLE'});return {status:'running',url:'http://localhost:3000',launched:false};}},request:async()=>{requests++;return {ok:true};},onStartup:result=>logs.push(result.status),onStartupError:error=>logs.push(error.message)});
  await runtime.start();
  await assert.rejects(runtime.call('get_status',{}),/port occupied/);assert.equal(requests,0);
  assert.equal((await runtime.call('ensure_service',{})).status,'running');
  assert.equal((await runtime.call('get_status',{})).ok,true);
  assert.equal(attempts,2);assert.deepEqual(logs,['port occupied','running']);
});

test('legacy stdio remains lazy and subsequent ensure checks current service rather than cached health',async()=>{
  let checks=0;const runtime=createBridgeRuntime({lifecycle:{ensure:async()=>({status:++checks===1?'started':'running'})},request:async()=>({offline:true})});
  await runtime.start();assert.equal(checks,0);
  assert.equal((await runtime.call('get_status',{})).offline,true);
  await runtime.call('ensure_service',{});await runtime.call('ensure_service',{});assert.equal(checks,2);
});
