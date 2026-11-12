import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppNavigator} from '../lib/server/appNavigator.ts';
import {createViewRegistry} from '../lib/server/viewRegistry.ts';
test('reuses focused app window across routes and waits for command acknowledgment',async()=>{
 const registry=createViewRegistry();let launches=0;
 const navigator=createAppNavigator({registry,launch:async()=>{launches++}});
 registry.heartbeat({viewId:'app',page:'home',ready:true,focused:true});
 const receipt=await navigator.open({tripId:'trip_a',page:'plan'},'http://localhost:3000');
 assert.equal(launches,0);assert.equal(receipt.reused,true);assert.equal(receipt.viewId,'app');
 registry.acknowledge('app',receipt.commandId,'running');
 registry.heartbeat({viewId:'app',tripId:'trip_a',page:'plan',ready:true});
 assert.equal(navigator.getCommand(receipt.commandId).status,'running');
 registry.acknowledge('app',receipt.commandId,'completed');
 assert.equal(navigator.getCommand(receipt.commandId).status,'completed');
});
test('coalesces native startup and correlates readiness, rejects ambiguous windows',async()=>{
 const registry=createViewRegistry();let launches=0;
 const navigator=createAppNavigator({registry,launch:async()=>{launches++}});
 const one=await navigator.open({tripId:'trip_a',page:'plan'},'http://localhost:3000');
 const two=await navigator.open({tripId:'trip_a',page:'plan'},'http://localhost:3000');
 assert.equal(one.commandId,two.commandId);assert.equal(launches,1);
 await assert.rejects(navigator.open({tripId:'trip_b',page:'plan'},'http://localhost:3000'),/APP_STARTING/);
 registry.heartbeat({viewId:'app',tripId:'trip_a',page:'plan',ready:true,launchId:one.commandId});
 assert.equal(navigator.getCommand(one.commandId).status,'completed');
 registry.heartbeat({viewId:'other',page:'home',ready:true});
 await assert.rejects(navigator.open({tripId:'trip_b',page:'plan'},'http://localhost:3000'),/AMBIGUOUS_VIEW/);
 const explicit=await navigator.open({tripId:'trip_b',page:'play',viewId:'other'},'http://localhost:3000');
 assert.equal(explicit.viewId,'other');assert.equal(launches,1);
});
test('late page readiness cannot complete an expired launch receipt',async()=>{
 let now=0;const registry=createViewRegistry({now:()=>now});
 const navigator=createAppNavigator({registry,launch:async()=>{},now:()=>now});
 const receipt=await navigator.open({tripId:'trip_a',page:'plan'},'http://localhost:3000');
 now=120001;registry.heartbeat({viewId:'late',tripId:'trip_a',page:'plan',ready:true,launchId:receipt.commandId});
 assert.equal(navigator.getCommand(receipt.commandId).status,'expired');
});
