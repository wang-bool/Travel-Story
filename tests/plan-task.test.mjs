import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TravelService} from '../lib/server/travelService.ts';
import {createPlanTaskRunner} from '../lib/server/planTasks.ts';
const place={name:'断桥',latitude:30.25,longitude:120.14,type:'bridge',city:'杭州',country:'中国'};
const plan=()=>({requestId:'confirmed-plan',viewId:'view',trip:{name:'杭州一日',startDate:'2026-11-06',endDate:'2026-11-06'},days:[{date:'2026-11-06',stops:[{candidateId:'a',transportToNext:'walk'},{candidateId:'b'}]}],review:{spatialNotes:'同片区测试地点，无住宿/预约约束。',days:[{date:'2026-11-06',availableMinutes:480,travelMinutes:60,visitMinutes:180,mealRestMinutes:90,bufferMinutes:60,basis:'测试数据，非真实旅行依据。'}]},finish:'play',calculateRoutes:false});
async function fixture(t,overrides={}){
 const directory=await mkdtemp(path.join(tmpdir(),'travel-plan-task-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const service=new TravelService(directory),events=[];
 const options={directory,service,assertView:()=>{},resolveCandidate:id=>({...place,name:id==='a'?'断桥':'秋月'}),present:async(name,result)=>{events.push({name,count:result.trip.stops.length});},finish:async(job)=>{events.push({name:'play',count:job.stops.length});},...overrides};
 return {runner:createPlanTaskRunner(options),options,service,events,directory};
}
const done=async(runner,taskId)=>{for(let i=0;i<30;i++){const r=await runner.get(taskId,1000);if(r.status!=='running')return r;}throw Error('task never finished');};

test('one submitted plan creates ordered stops and transportation with an acknowledged display per write',async t=>{
 const f=await fixture(t);const initial=await f.runner.apply(plan(),'http://localhost:3000');
 const result=await done(f.runner,initial.taskId);assert.equal(result.status,'completed',JSON.stringify(result));
 const {trip}=await f.service.execute('get_trip',{tripId:result.tripId});assert.deepEqual(trip.stops.map(s=>s.name),['断桥','秋月']);assert.equal(trip.segments[0].transport,'walk');
 assert.deepEqual(f.events.map(e=>e.name),['create_trip','edit_itinerary','edit_itinerary','edit_itinerary','play']);
 assert.equal(result.progress.completed,result.progress.total);assert.equal('trip' in result,false,'Task responses stay compact');
});

test('unready view is rejected before a task can write data',async t=>{
 const f=await fixture(t,{assertView:()=>{throw Object.assign(Error('not ready'),{code:'VIEW_NOT_READY'});}});
 await assert.rejects(f.runner.apply(plan(),'http://localhost:3000'),/not ready/);assert.equal((await f.service.snapshot()).trips.length,0);
});

test('failed presentation resumes a saved mutation without duplicates, re-search or a second create',async t=>{
 let fail=true,resolved=0;const f=await fixture(t,{resolveCandidate:id=>{resolved++;return {...place,name:id};},present:async(name,result)=>{if(fail&&name==='edit_itinerary'&&result.trip.stops.length===1){fail=false;throw Object.assign(Error('page disconnected'),{code:'VIEW_NOT_CONNECTED'});}}});
 const initial=await f.runner.apply(plan(),'http://localhost:3000');const failed=await done(f.runner,initial.taskId);assert.equal(failed.status,'failed');
 assert.equal((await f.service.snapshot()).trips[0].stops.length,1);
 const afterRestart=createPlanTaskRunner({...f.options,resolveCandidate:()=>{throw Error('expired candidate must not be re-resolved');}});
 const resumed=await afterRestart.apply({...plan(),viewId:'restored-view'},'http://localhost:3000');assert.equal(resumed.taskId,initial.taskId);
 const complete=await done(afterRestart,resumed.taskId);assert.equal(complete.status,'completed',JSON.stringify(complete));assert.equal(resolved,2);
 const trips=(await f.service.snapshot()).trips;assert.equal(trips.length,1);assert.equal(trips[0].stops.length,2);
});

test('same task id with changed plan is rejected and concurrent identical submissions coalesce',async t=>{
 const f=await fixture(t);const [a,b]=await Promise.all([f.runner.apply(plan(),'http://localhost:3000'),f.runner.apply(plan(),'http://localhost:3000')]);assert.equal(a.taskId,b.taskId);
 await assert.rejects(f.runner.apply({...plan(),trip:{...plan().trip,name:'different'}},'http://localhost:3000'),e=>e.code==='REQUEST_ID_REUSED');
 await done(f.runner,a.taskId);assert.equal((await f.service.snapshot()).trips.length,1);
});

test('existing trip cannot silently omit or delete stored stops',async t=>{
 const f=await fixture(t);const created=await f.service.execute('create_trip',{...plan().trip,requestId:'seed'});
 const edited=await f.service.execute('edit_itinerary',{tripId:created.tripId,expectedRevision:created.revision,requestId:'seed-stop',operations:[{op:'add_stop',dayId:created.trip.days[0].id,place}]},'web');
 await assert.rejects(f.runner.apply({...plan(),tripId:created.tripId,expectedRevision:edited.revision},'http://localhost:3000'),e=>e.code==='PLAN_OMITS_EXISTING_STOPS');
 assert.equal((await f.service.snapshot()).trips[0].stops.length,1);
});

test('a lost mutation response replays its journaled request instead of creating a second trip',async t=>{
 const f=await fixture(t);let lose=true;
 const actual=f.service.execute.bind(f.service);
 f.service.execute=async(...args)=>{const result=await actual(...args);if(lose&&args[0]==='create_trip'){lose=false;throw Error('response lost after commit');}return result;};
 const initial=await f.runner.apply(plan(),'http://localhost:3000');assert.equal((await done(f.runner,initial.taskId)).status,'failed');
 await f.runner.apply(plan(),'http://localhost:3000');assert.equal((await done(f.runner,initial.taskId)).status,'completed');
 assert.equal((await f.service.snapshot()).trips.length,1);
});

test('external edits after a display interruption are preserved and cause a conflict on resume',async t=>{
 let fail=true;const f=await fixture(t,{present:async name=>{if(fail&&name==='edit_itinerary'){fail=false;throw Object.assign(Error('disconnected'),{code:'VIEW_NOT_CONNECTED'});}}});
 const initial=await f.runner.apply(plan(),'http://localhost:3000');const failed=await done(f.runner,initial.taskId);
 await f.service.execute('update_trip',{tripId:failed.tripId,expectedRevision:failed.revision,requestId:'user-edit',patch:{name:'用户手动修改'}});
 await f.runner.apply(plan(),'http://localhost:3000');const conflict=await done(f.runner,initial.taskId);assert.equal(conflict.error.code,'REVISION_CONFLICT');assert.equal(conflict.resumable,false);
 const trip=(await f.service.snapshot()).trips[0];assert.equal(trip.name,'用户手动修改');assert.equal(trip.stops.length,1);
});

test('existing stop references can reorder a full plan without re-searching or losing stored data',async t=>{
 const f=await fixture(t);const a=await f.runner.apply(plan(),'http://localhost:3000');const old=await done(f.runner,a.taskId);
 const before=(await f.service.snapshot()).trips[0];const next={...plan(),requestId:'reorder-confirmed',tripId:old.tripId,expectedRevision:old.revision,days:[{date:'2026-11-06',stops:[{stopId:before.stops[1].id,transportToNext:'walk'},{stopId:before.stops[0].id}]}]};
 const submitted=await f.runner.apply(next,'http://localhost:3000');const result=await done(f.runner,submitted.taskId);assert.equal(result.status,'completed',JSON.stringify(result));
 assert.deepEqual((await f.service.snapshot()).trips[0].stops.map(s=>s.id),[before.stops[1].id,before.stops[0].id]);
});


test('an interrupted create receipt survives normal request history pruning',async t=>{
 const f=await fixture(t);let lose=true;const actual=f.service.execute.bind(f.service);
 f.service.execute=async(...args)=>{const result=await actual(...args);if(lose&&args[0]==='create_trip'){lose=false;throw Error('lost create response');}return result;};
 const initial=await f.runner.apply(plan(),'http://localhost:3000');await done(f.runner,initial.taskId);
 const dbPath=path.join(f.directory,'trips.json'),db=JSON.parse(await readFile(dbPath,'utf8'));
 for(let i=0;i<1001;i++)db.requests[`unrelated-${i}`]={fingerprint:'test',result:{}};
 await writeFile(dbPath,JSON.stringify(db));
 const trip=db.trips[0];await f.service.execute('create_trip',{name:'unrelated',startDate:'2026-11-07',endDate:'2026-11-07',requestId:'unrelated-new'});
 await f.runner.apply(plan(),'http://localhost:3000');const complete=await done(f.runner,initial.taskId);assert.equal(complete.status,'completed',JSON.stringify(complete));
 assert.equal(complete.tripId,trip.id);assert.equal((await f.service.snapshot()).trips.filter(t=>t.name==='杭州一日').length,1);
});

test('an external edit during finish cannot be reported as the confirmed plan being completed',async t=>{
 const f=await fixture(t,{finish:async job=>{await f.service.execute('update_trip',{tripId:job.tripId,expectedRevision:job.revision,requestId:'edit-during-play',patch:{name:'changed'}});}});
 const initial=await f.runner.apply(plan(),'http://localhost:3000');const end=await done(f.runner,initial.taskId);assert.equal(end.status,'failed');assert.equal(end.error.code,'REVISION_CONFLICT');
});

test('automatic web route writes are deferred while a plan owns the trip',async t=>{
 const f=await fixture(t);let attempted=false;
 const runner=createPlanTaskRunner({...f.options,present:async(name,result)=>{
  if(result.trip.stops.length===2&&!attempted){attempted=true;assert.equal(f.service.isPlanTaskActive(result.tripId),true);assert.equal((await f.service.snapshot()).trips[0].agentTaskActive,true);
   await assert.rejects(f.service.execute('calculate_routes',{tripId:result.tripId,expectedRevision:result.revision,requestId:'automatic-route'},'web'),e=>e.code==='PLAN_TASK_ACTIVE');
  }
 }});
 const submitted=await runner.apply(plan(),'http://localhost:3000');const result=await done(runner,submitted.taskId);assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(attempted,true);
 assert.equal(f.service.isPlanTaskActive(result.tripId),false);assert.equal((await f.service.snapshot()).trips[0].agentTaskActive,undefined);
});

test('recoverable display failure keeps automatic routes paused across service restart and can resume',async t=>{
 let failedOnce=false;
 const f=await fixture(t,{present:async(name,result)=>{if(!failedOnce&&result.trip.stops.length===2){failedOnce=true;throw Object.assign(Error('page disconnected'),{code:'VIEW_NOT_CONNECTED'});}}});
 const initial=await f.runner.apply(plan(),'http://localhost:3000');const failed=await done(f.runner,initial.taskId);
 assert.equal(failed.resumable,true);
 assert.equal((await f.service.snapshot()).trips[0].agentTaskActive,true);
 const restartedService=new TravelService(f.directory);
 assert.equal((await restartedService.snapshot()).trips[0].agentTaskActive,true);
 await assert.rejects(restartedService.execute('calculate_routes',{tripId:failed.tripId,expectedRevision:failed.revision,requestId:'reconnected-auto-route'},'web'),e=>e.code==='PLAN_TASK_ACTIVE');
 assert.equal((await restartedService.execute('get_trip',{tripId:failed.tripId})).revision,failed.revision);
 const restartedRunner=createPlanTaskRunner({...f.options,service:restartedService});
 await restartedRunner.apply(plan(),'http://localhost:3000');const completed=await done(restartedRunner,initial.taskId);
 assert.equal(completed.status,'completed',JSON.stringify(completed));
 assert.equal((await new TravelService(f.directory).snapshot()).trips[0].agentTaskActive,undefined);
});

test('explicit successful content edits release a suspended task lease while rejected edits do not',async t=>{
 const f=await fixture(t,{present:async(name,result)=>{if(result.trip.stops.length===2)throw Object.assign(Error('page disconnected'),{code:'VIEW_NOT_CONNECTED'});}});
 const initial=await f.runner.apply(plan(),'http://localhost:3000');const failed=await done(f.runner,initial.taskId);
 const service=new TravelService(f.directory);
 await assert.rejects(service.execute('update_trip',{tripId:failed.tripId,expectedRevision:failed.revision-1,requestId:'stale-manual-edit',patch:{name:'stale'}}),e=>e.code==='REVISION_CONFLICT');
 assert.equal((await service.snapshot()).trips[0].agentTaskActive,true);
 await service.execute('update_trip',{tripId:failed.tripId,expectedRevision:failed.revision,requestId:'manual-edit',patch:{name:'user changed'}});
 assert.equal((await new TravelService(f.directory).snapshot()).trips[0].agentTaskActive,undefined);
});

test('a lost create response still persists its route lease atomically with the trip',async t=>{
 const f=await fixture(t);const actual=f.service.execute.bind(f.service);
 f.service.execute=async(...args)=>{const result=await actual(...args);if(args[0]==='create_trip')throw Error('response lost');return result;};
 const initial=await f.runner.apply(plan(),'http://localhost:3000');assert.equal((await done(f.runner,initial.taskId)).resumable,true);
 assert.equal((await new TravelService(f.directory).snapshot()).trips[0].agentTaskActive,true);
});

test('a persisted completed task releases a lease left by a crash before cleanup',async t=>{
 const f=await fixture(t);const initial=await f.runner.apply(plan(),'http://localhost:3000');const completed=await done(f.runner,initial.taskId);
 const file=path.join(f.directory,'trips.json'),db=JSON.parse(await readFile(file,'utf8'));
 db.planOwners={[completed.tripId]:completed.taskId};await writeFile(file,JSON.stringify(db));
 const jobFile=path.join(f.directory,'agent-plans',`${completed.taskId}.json`),job=JSON.parse(await readFile(jobFile,'utf8'));
 await writeFile(jobFile,JSON.stringify({...job,status:'running'}));
 const restarted=new TravelService(f.directory);assert.equal((await restarted.snapshot()).trips[0].agentTaskActive,true);
 await writeFile(jobFile,JSON.stringify(job));
 let notified=false;restarted.onChange(()=>{notified=true;});
 assert.equal((await restarted.snapshot()).trips[0].agentTaskActive,undefined);
 assert.equal(notified,true,'Terminal lease cleanup wakes connected pages');
 assert.equal(JSON.parse(await readFile(file,'utf8')).planOwners[completed.tripId],undefined,'Reconciliation persists cleanup instead of rescanning terminal journals forever');
});


test('deleting a suspended task trip removes its persisted lease',async t=>{
 const f=await fixture(t,{present:async(name,result)=>{if(result.trip.stops.length===2)throw Object.assign(Error('disconnected'),{code:'VIEW_NOT_CONNECTED'});}});
 const initial=await f.runner.apply(plan(),'http://localhost:3000');const failed=await done(f.runner,initial.taskId);
 await f.service.execute('delete_trip',{tripId:failed.tripId,expectedRevision:failed.revision,requestId:'manual-delete'});
 const db=JSON.parse(await readFile(path.join(f.directory,'trips.json'),'utf8'));
 assert.equal(db.planOwners[failed.tripId],undefined);assert.equal((await new TravelService(f.directory).snapshot()).trips.length,0);
});
