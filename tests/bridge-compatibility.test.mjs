import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeRuntime} from '../mcp/bridgeRuntime.mjs';

const modern=()=>({version:'0.2.0',capabilities:{planTasks:true,searchActivity:true,planReview:true}});
test('status identifies an old web process and no low-level mutation is sent to it',async()=>{
 const calls=[];const runtime=createBridgeRuntime({lifecycle:{},request:async(name)=>{calls.push(name);return {version:'0.2.0',capabilities:{mcp:true}};}});
 const result=await runtime.call('get_status',{});
 assert.equal(result.compatibility?.status,'restart_required');
 await assert.rejects(runtime.call('create_trip',{requestId:'no-write'}),e=>e.code==='SERVICE_VERSION_MISMATCH');
 assert.deepEqual(calls,['get_status']);
});
test('first mutation checks once, further mutations reuse compatible status',async()=>{
 const calls=[];const runtime=createBridgeRuntime({lifecycle:{},request:async name=>{calls.push(name);return name==='get_status'?modern():{ok:true};}});
 await runtime.call('create_trip',{});await runtime.call('edit_itinerary',{});
 assert.deepEqual(calls,['get_status','create_trip','edit_itinerary']);
});
test('fresh status after restarting the web app clears the incompatible state',async()=>{
 let updated=false;const runtime=createBridgeRuntime({lifecycle:{},request:async name=>name==='get_status'?(updated?modern():{capabilities:{}}):{ok:true}});
 await runtime.call('get_status',{});
 await assert.rejects(runtime.call('apply_plan',{}),e=>e.code==='SERVICE_VERSION_MISMATCH');
 updated=true;assert.equal((await runtime.call('get_status',{})).compatibility.status,'compatible');
 assert.deepEqual(await runtime.call('apply_plan',{}),{ok:true});
});
test('unknown remote tools mark incompatibility and never trigger mutation retry or fallback',async()=>{
 const calls=[];const runtime=createBridgeRuntime({lifecycle:{},request:async name=>{calls.push(name);if(name==='get_status')return modern();throw Object.assign(Error('Unknown tool'),{code:'UNKNOWN_TOOL'});}});
 await assert.rejects(runtime.call('apply_plan',{}),e=>e.code==='SERVICE_VERSION_MISMATCH');
 await assert.rejects(runtime.call('create_trip',{}),e=>e.code==='SERVICE_VERSION_MISMATCH');
 assert.deepEqual(calls,['get_status','apply_plan']);
});
test('transport failure of a write is not retried',async()=>{
 let writes=0;const runtime=createBridgeRuntime({lifecycle:{},request:async name=>{if(name==='get_status')return modern();writes++;throw Object.assign(Error('response lost'),{code:'SERVICE_UNAVAILABLE'});}});
 await assert.rejects(runtime.call('edit_itinerary',{}),e=>e.code==='SERVICE_UNAVAILABLE');assert.equal(writes,1);
});
test('connection loss invalidates compatibility before the next write to a replaced app',async()=>{
 const calls=[];let state='modern';const runtime=createBridgeRuntime({lifecycle:{},request:async name=>{
  calls.push(name);
  if(state==='offline')throw Object.assign(Error('offline'),{code:'SERVICE_UNAVAILABLE'});
  if(name==='get_status')return state==='modern'?modern():{version:'0.2.0',capabilities:{mcp:true}};
  return {ok:true};
 }});
 await runtime.call('get_status',{});state='offline';
 await assert.rejects(runtime.call('get_status',{}),e=>e.code==='SERVICE_UNAVAILABLE');
 state='old';await assert.rejects(runtime.call('create_trip',{}),e=>e.code==='SERVICE_VERSION_MISMATCH');
 assert.deepEqual(calls,['get_status','get_status','get_status']);
});
