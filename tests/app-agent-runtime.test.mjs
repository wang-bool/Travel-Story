import assert from 'node:assert/strict';
import test from 'node:test';
import {appRoute, navigationTarget} from '../lib/appNavigation.ts';
import {createAppAgentRuntime} from '../lib/appAgentRuntime.ts';
test('navigation only accepts business targets, route parsing supports all pages',()=>{
 assert.equal(navigationTarget({tripId:'trip_1',page:'plan'}).href,'/trip/trip_1');
 assert.throws(()=>navigationTarget({tripId:'../secret',page:'plan'}));
 assert.throws(()=>navigationTarget({tripId:'trip_1',page:'https://evil'}));
 assert.equal(appRoute('/').page,'home');assert.equal(appRoute('/trip/trip_1/record').page,'record');
});
test('one runtime navigates home to ready target and applies selection using fresh handler',async()=>{
 let route=appRoute('/'), runtime;const events=[];
 runtime=createAppAgentRuntime({route:()=>route,navigate:async target=>{
  route=appRoute(target.href);runtime.register({tripId:'trip_1',page:'plan',ready:false,onCommand:async()=>{throw Error('stale');}});
 },refresh:async()=>{},read:()=>({revision:3}),commit:async()=>{},sleep:async()=>{
  runtime.register({tripId:'trip_1',page:'plan',ready:true,onCommand:async command=>events.push(command.action)});
 }});
 await runtime.execute({commandId:'c',tripId:'trip_1',action:'navigate',args:{tripId:'trip_1',page:'plan',revision:3,stopId:'stop_1'},expiresAt:Date.now()+1000});
 assert.deepEqual(events,['focus_stop']);assert.equal(runtime.view().tripId,'trip_1');
});
test('manual navigation and handler replacement reject stale page receipts',async()=>{
 let route=appRoute('/trip/trip_1');const runtime=createAppAgentRuntime({route:()=>route,navigate:async()=>{},refresh:async()=>{},read:()=>({revision:3}),commit:async()=>{},sleep:async()=>{}});
 runtime.register({tripId:'trip_1',page:'plan',ready:true,onCommand:async()=>{route=appRoute('/');}});
 await assert.rejects(()=>runtime.execute({commandId:'c',tripId:'trip_1',action:'fit_trip',args:{},expiresAt:Date.now()+1000}),/页面已切换/);
});
test('home and record report ready without a leaf handler, maps do not',()=>{
 let route=appRoute('/');const runtime=createAppAgentRuntime({route:()=>route,navigate:()=>{},refresh:async()=>{},read:()=>null});
 assert.equal(runtime.view().ready,true);
 route=appRoute('/trip/trip_1/record');assert.equal(runtime.view().ready,true);
 route=appRoute('/trip/trip_1');assert.equal(runtime.view().ready,false);
});
test('a manually changed route cancels pending navigation before target readiness',async()=>{
 let route=appRoute('/');const runtime=createAppAgentRuntime({route:()=>route,navigate:target=>{route=appRoute(target.href);},refresh:async()=>{},read:()=>({revision:1}),commit:async()=>{},sleep:async()=>{route=appRoute('/trip/trip_other');}});
 await assert.rejects(()=>runtime.execute({commandId:'c',tripId:'trip_1',action:'navigate',args:{tripId:'trip_1',page:'plan'},expiresAt:Date.now()+1000}),/页面已切换/);
});
test('a handler replaced during an operation cannot acknowledge success',async()=>{
 const route=appRoute('/trip/trip_1');const runtime=createAppAgentRuntime({route:()=>route,navigate:()=>{},refresh:async()=>{},read:()=>({revision:1}),commit:async()=>{}});
 runtime.register({tripId:'trip_1',page:'plan',ready:true,onCommand:async()=>{
  runtime.register({tripId:'trip_1',page:'plan',ready:true,onCommand:async()=>{}});
 }});
 await assert.rejects(()=>runtime.execute({commandId:'c',tripId:'trip_1',action:'fit_trip',args:{},expiresAt:Date.now()+1000}),/页面已切换/);
});
test('a presentation on the current page reveals the existing application host',async()=>{
 const calls=[];const runtime=createAppAgentRuntime({route:()=>appRoute('/trip/trip_1'),navigate:()=>{},refresh:async()=>{},read:()=>({revision:1}),commit:async()=>{},reveal:async()=>{calls.push('reveal');}});
 runtime.register({tripId:'trip_1',page:'plan',ready:true,onCommand:async()=>{calls.push('present');}});
 await runtime.execute({commandId:'c',tripId:'trip_1',action:'present_change',args:{revision:1},expiresAt:Date.now()+1000});
 assert.deepEqual(calls,['reveal','present']);
});
