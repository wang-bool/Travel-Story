import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForPresentationRevision} from '../lib/agentPresentation.ts';
test('presentation refreshes authoritative data then waits for revision and two committed frames',async()=>{
 let revision=1,refreshes=0;const events=[];
 await waitForPresentationRevision(3,{
  read:()=>({revision}),refresh:async()=>{events.push('refresh');if(++refreshes===2)revision=3;},
  sleep:async()=>{events.push('wait');},commit:async()=>{events.push('frame');},
 });
 assert.deepEqual(events,['refresh','wait','refresh','frame','frame']);
});
test('even a matching cached revision is refreshed before presentation',async()=>{
 const events=[];
 await waitForPresentationRevision(2,{read:()=>({revision:2}),refresh:async()=>{events.push('refresh');},commit:async()=>{events.push('frame');}});
 assert.deepEqual(events,['refresh','frame','frame']);
});
test('stale data or cancelled page never pass the presentation barrier',async()=>{
 let now=0;
 await assert.rejects(()=>waitForPresentationRevision(3,{read:()=>({revision:1}),refresh:async()=>{},now:()=>now,sleep:async()=>{now+=100;},timeoutMs:200}),/最新行程/);
 await assert.rejects(()=>waitForPresentationRevision(3,{read:()=>({revision:3}),refresh:async()=>{},cancelled:()=>true}),/取消/);
});

test('expiry while waiting for React commit cancels presentation before callback',async()=>{
 let expired=false;
 await assert.rejects(()=>waitForPresentationRevision(3,{
  read:()=>({revision:3}),refresh:async()=>{},cancelled:()=>expired,
  commit:async()=>{expired=true;},
 }),/取消/);
});

test('explicit latest day target wins over earlier added stop in mixed edit batch',async()=>{
 const {resolvePresentationTarget}=await import('../lib/agentPresentation.ts');
 assert.deepEqual(resolvePresentationTarget({dayId:'day_2',addedStopIds:['stop_day_1']}),{dayId:'day_2'});
 assert.deepEqual(resolvePresentationTarget({stopId:'stop_explicit',dayId:'day_2',addedStopIds:['stop_older']}),{stopId:'stop_explicit',dayId:'day_2'});
 assert.deepEqual(resolvePresentationTarget({addedStopIds:['stop_first','stop_latest']}),{stopId:'stop_latest'});
});
test('a target deleted by a later edit is reported instead of silently fitting the whole map',async()=>{const {resolvePresentationTarget}=await import('../lib/agentPresentation.ts');assert.throws(()=>resolvePresentationTarget({stopId:'removed'},{stops:[],days:[]}),/不存在/);});
