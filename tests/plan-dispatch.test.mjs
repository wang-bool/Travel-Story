import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {TravelService} from '../lib/server/travelService.ts';
import {createViewRegistry} from '../lib/server/viewRegistry.ts';
import {createToolDispatcher} from '../lib/server/toolDispatcher.ts';

test('high-level task waits for the readiness heartbeat after a navigation receipt before playing',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'plan-dispatch-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const service=new TravelService(directory),registry=createViewRegistry();const call=createToolDispatcher({service,registry,open:async()=>{throw Error('must reuse bound view');}});
 registry.heartbeat({viewId:'test-page',page:'home',ready:true});
 const oldFetch=globalThis.fetch,oldKey=process.env.LOCATIONIQ_KEY,oldGaode=process.env.GAODE_KEY;process.env.LOCATIONIQ_KEY='test';delete process.env.GAODE_KEY;
 globalThis.fetch=async()=>Response.json([{place_id:998123,name:'Paris fixture',display_name:'Paris, France',lat:'48.85',lon:'2.35'}]);
 const result=await call('search_places',{query:'dispatch-task-fixture',countryCode:'FR',viewId:'test-page'});
 globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.LOCATIONIQ_KEY;else process.env.LOCATIONIQ_KEY=oldKey;if(oldGaode===undefined)delete process.env.GAODE_KEY;else process.env.GAODE_KEY=oldGaode;
 const timers=[],actions=[];
 const poll=setInterval(()=>{for(const command of registry.pending('test-page')){
  registry.acknowledge('test-page',command.commandId,'running');actions.push(command.action);
  if(command.action==='navigate'){
   registry.heartbeat({viewId:'test-page',tripId:command.args.tripId,page:command.args.page,ready:false});
   registry.acknowledge('test-page',command.commandId,'completed');
   timers.push(setTimeout(()=>registry.heartbeat({viewId:'test-page',tripId:command.args.tripId,page:command.args.page,ready:true}),500));
  }else registry.acknowledge('test-page',command.commandId,'completed');
 }},5);
 try{
  const candidateId=result.candidates[0].candidateId;
  const submitted=await call('apply_plan',{requestId:'ready-lag',viewId:'test-page',trip:{name:'Ready lag',startDate:'2026-11-06',endDate:'2026-11-06'},days:[{date:'2026-11-06',stops:[{candidateId,transportToNext:'walk'},{candidateId}]}],review:{spatialNotes:'同片区测试地点，无往返。',days:[{date:'2026-11-06',availableMinutes:480,travelMinutes:60,visitMinutes:180,mealRestMinutes:90,bufferMinutes:60,basis:'测试夹具，非真实旅行依据。'}]},calculateRoutes:false});
  const end=await call('get_plan_task',{taskId:submitted.taskId,waitMs:10000});assert.equal(end.status,'completed',JSON.stringify(end));assert.equal(actions.at(-1),'play');assert.equal(actions.filter(a=>a==='navigate').length,2);
 }finally{clearInterval(poll);timers.forEach(clearTimeout);}
});
