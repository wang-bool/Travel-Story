import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentActivityStore, getAgentActivityStore } from '../lib/server/agentActivity.ts';
import { searchForAgent, markCandidateAdopted } from '../lib/server/placeSearch.ts';

test('activity snapshots isolate views, protect state and retain only thirty recent records', () => {
 const store=createAgentActivityStore(); let notices=0;
 const off=store.subscribe('a',()=>notices++);
 const id=store.start({viewId:'a',kind:'search',title:'地点搜索',query:{query:'Paris'}});
 store.start({viewId:'b',kind:'search',title:'other'});
 assert.equal(notices,1); assert.equal(store.list('a').length,1);
 const snapshot=store.list('a');snapshot[0].title='tampered';assert.equal(store.list('a')[0].title,'地点搜索');
 store.update(id,{status:'completed'});assert.equal(notices,2);off();
 for(let i=0;i<35;i++)store.start({viewId:'a',kind:'search',title:String(i)});
 assert.equal(store.list('a').length,30);assert.equal(store.list('b').length,1);
 assert.throws(()=>store.start({viewId:'',kind:'search',title:'invalid'}));
});

test('adoption updates preserve search duration and untrusted provider errors stay private',async()=>{
 const store=getAgentActivityStore();process.env.LOCATIONIQ_KEY='private-key';delete process.env.GAODE_KEY;
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error('https://provider.test?token=private-key');};
 try {
  await searchForAgent({query:'safe-error-activity'},{viewId:'safe-errors'});
  const failure=store.list('safe-errors')[0];assert.equal(failure.status,'failed');assert.doesNotMatch(JSON.stringify(failure),/private-key|provider\.test/);
  assert.equal(typeof failure.durationMs,'number');
  store.update(failure.id,{message:'later update'});assert.equal(store.list('safe-errors')[0].durationMs,failure.durationMs);
 }finally{globalThis.fetch=original;delete process.env.LOCATIONIQ_KEY;}
});

test('MCP searches publish lifecycle, cache provenance, stable IDs and view-scoped adoption',async()=>{
 process.env.LOCATIONIQ_KEY='activity-test';delete process.env.GAODE_KEY;
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json([{place_id:981,name:'Paris',display_name:'Paris, France',lat:'48.85',lon:'2.35'}]);};
 const store=getAgentActivityStore();const seen=[];const off=store.subscribe('activity-view',()=>seen.push(store.list('activity-view')));
 try {
  const input={query:'activity-test-query',countryCode:'FR'};
  const a=await searchForAgent(input,{viewId:'activity-view'});
  const b=await searchForAgent(input,{viewId:'activity-view'});
  assert.equal(seen[0][0].status,'running');assert.equal(store.list('activity-view').at(-1).status,'completed');
  assert.equal(a.cached,false);assert.equal(b.cached,true);assert.equal(calls,1);
  assert.equal(a.candidates[0].candidateId,b.candidates[0].candidateId);
  await searchForAgent(input,{viewId:'another-view'});
  markCandidateAdopted(a.candidates[0].candidateId,'activity-view');
  assert.deepEqual(store.list('activity-view')[0].selectedCandidateIds,[a.candidates[0].candidateId]);
  assert.equal(store.list('another-view')[0].selectedCandidateIds,undefined);
  const before=store.list('activity-view').length;await searchForAgent(input);assert.equal(store.list('activity-view').length,before);
 }finally{off();globalThis.fetch=original;delete process.env.LOCATIONIQ_KEY;}
});
