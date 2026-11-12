import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TravelService} from '../lib/server/travelService.ts';
import {createPlanTaskRunner} from '../lib/server/planTasks.ts';

const review=()=>({spatialNotes:'同一片区步行连接，无跨区往返；无固定住宿约束。',days:[{date:'2026-11-06',availableMinutes:480,travelMinutes:60,visitMinutes:180,mealRestMinutes:90,bufferMinutes:60,basis:'测试夹具时间预算，游览范围为两处街区；非真实旅行资料。'}]});
const plan=()=>({requestId:'review-plan',viewId:'view',trip:{name:'Review fixture',startDate:'2026-11-06',endDate:'2026-11-06'},days:[{date:'2026-11-06',stops:[{candidateId:'one'}]}],calculateRoutes:false,review:review()});
async function fixture(t,overrides={}){
 const directory=await mkdtemp(path.join(tmpdir(),'travel-review-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const service=new TravelService(directory);
 const runner=createPlanTaskRunner({directory,service,assertView:()=>{},resolveCandidate:()=>({name:'Fixture',latitude:30,longitude:120,type:'attraction'}),present:async()=>{},finish:async()=>{},...overrides});
 const apply=async input=>{const start=await runner.apply(input,'http://localhost:3000');return runner.get(start.taskId,20000);};
 return {directory,service,runner,apply};
}
test('a new task without planning review is rejected before creating a trip',async t=>{
 const f=await fixture(t),input=plan();delete input.review;
 await assert.rejects(f.apply(input),e=>e.code==='PLAN_REVIEW_REQUIRED');assert.equal((await f.service.snapshot()).trips.length,0);
});
test('travel, visits, meals/rest and buffer must fit inside the declared day window',async t=>{
 const f=await fixture(t),input=plan();input.review.days[0].travelMinutes=331;input.review.days[0].visitMinutes=360;
 await assert.rejects(f.apply(input),e=>e.code==='PLAN_TIME_EXCEEDED'&&e.message.includes('2026-11-06'));assert.equal((await f.service.snapshot()).trips.length,0);
});
test('review must cover the exact submitted dates without duplicate or missing days',async t=>{
 const f=await fixture(t),input=plan();input.review.days[0].date='2026-11-07';
 await assert.rejects(f.apply(input),e=>e.code==='INVALID_PLAN_REVIEW');assert.equal((await f.service.snapshot()).trips.length,0);
});
test('valid review permits execution but is not invented as trip or stop fields',async t=>{
 const f=await fixture(t),end=await f.apply(plan());assert.equal(end.status,'completed',JSON.stringify(end));
 const {trip}=await f.service.execute('get_trip',{tripId:end.tripId});assert.equal(trip.review,undefined);assert.equal(trip.stops[0].visitMinutes,undefined);
});
test('invalid numbers and blank spatial reasoning are rejected without a trip',async t=>{
 const f=await fixture(t),input=plan();input.review.spatialNotes=' ';input.review.days[0].bufferMinutes=-1;
 await assert.rejects(f.apply(input),e=>e.code==='INVALID_PLAN_REVIEW');assert.equal((await f.service.snapshot()).trips.length,0);
});
test('a rejected review can be corrected with the same request ID because no task was saved',async t=>{
 const f=await fixture(t),input=plan();input.review.days[0].availableMinutes=30;
 await assert.rejects(f.apply(input),e=>e.code==='PLAN_TIME_EXCEEDED');
 assert.equal((await f.apply(plan())).status,'completed');
});
test('an older persisted interrupted task resumes with its unchanged review-free input',async t=>{
 let first=true;const f=await fixture(t,{present:async()=>{if(first){first=false;throw Object.assign(Error('disconnected'),{code:'VIEW_NOT_CONNECTED'});}}});
 const failed=await f.apply(plan());assert.equal(failed.status,'failed');
 const file=path.join(f.directory,'agent-plans',`${failed.taskId}.json`),job=JSON.parse(await readFile(file,'utf8'));
 delete job.input.review;
 const {viewId,...identity}=job.input;
 const stable=JSON.stringify(identity,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 job.fingerprint=createHash('sha256').update(stable).digest('hex');await writeFile(file,JSON.stringify(job));
 const input=plan();delete input.review;
 const completed=await f.apply(input);assert.equal(completed.status,'completed',JSON.stringify(completed));assert.equal((await f.service.snapshot()).trips.length,1);
});
