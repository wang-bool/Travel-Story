import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {check,date,dayCount,place} from '../domain/itinerary.ts';
import {isRecoverablePlanError, type TravelService} from './travelService.ts';
import {getAgentActivityStore} from './agentActivity.ts';
import {validatePlanReview} from '../../mcp/planReview.mjs';

type Data = Record<string, any>;
interface PlanStop {date:string;position:number;candidateId?:string;stopId?:string;place?:Data;transportToNext?:string}
interface SavedStep {key:string;name:string;input:Data;saved?:{tripId:string;revision:number;results?:Data[];routes?:Data[]}}
interface Job {
 taskId:string;fingerprint:string;input:Data;base:string;status:'running'|'completed'|'failed';
 tripId?:string;revision?:number;stops:PlanStop[];completed:number;total:number;label:string;
 current?:SavedStep;attempt:number;updatedAt:number;error?:{code:string;message:string};
}
interface Options {
 directory:string;service:TravelService;
 assertView:(viewId:string)=>void|Promise<void>;
 resolveCandidate:(id:string)=>Data;
 present:(name:string,result:Data,viewId:string,requestId:string,base:string)=>Promise<void>;
 finish:(job:{tripId:string;revision:number;viewId:string;finish:'plan'|'play';stops:PlanStop[];base:string})=>Promise<void>;
 adopted?:(candidateId:string,viewId:string)=>void;
}
const stable=(value:unknown)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const idPattern=/^plan_[a-f0-9]{32}$/;
const safeError=(error:unknown)=>{const e=error as {code?:string};const code=typeof e?.code==='string'?e.code:'TASK_FAILED';return {code,message:({VIEW_NOT_CONNECTED:'页面已断开，请恢复页面后重试同一任务',VIEW_NOT_READY:'页面尚未就绪，请恢复页面后重试同一任务',VIEW_FAILED:'页面展示失败，请恢复页面后重试同一任务',REVISION_CONFLICT:'行程已被其他操作修改，请核对后调整计划',TASK_FAILED:'计划执行中断，请恢复页面后重试同一任务'} as Record<string,string>)[code]??`计划执行未完成（${code}）`};};

/** Durable task journal: saved data and acknowledged presentation advance independently. */
export function createPlanTaskRunner(options:Options) {
 const directory=path.join(options.directory,'agent-plans');
 const running=new Map<string,Promise<void>>(),locks=new Map<string,Promise<unknown>>();
 const activity=getAgentActivityStore();
 const file=(taskId:string)=>{check(idPattern.test(taskId),'INVALID_INPUT','Invalid task ID');return path.join(directory,`${taskId}.json`);};
 async function load(taskId:string):Promise<Job|undefined>{try{return JSON.parse(await fs.readFile(file(taskId),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}}
 async function save(job:Job){await fs.mkdir(directory,{recursive:true});job.updatedAt=Date.now();const target=file(job.taskId),temporary=`${target}.${randomUUID()}.tmp`;await fs.writeFile(temporary,JSON.stringify(job),{mode:0o600});await fs.rename(temporary,target);}
 const summary=(job:Job)=>({taskId:job.taskId,status:job.status,...(job.tripId?{tripId:job.tripId,url:new URL(`/trip/${job.tripId}`,job.base).toString()}:{}),...(job.revision?{revision:job.revision}:{}),progress:{completed:job.completed,total:job.total,label:job.label},...(job.error?{error:job.error}:{}),resumable:job.status==='failed'&&isRecoverablePlanError(job.error?.code)});
 async function readTrip(job:Job){check(job.tripId,'TRIP_NOT_FOUND','Task has no saved trip');return options.service.execute('get_trip',{tripId:job.tripId});}
 async function validate(input:Data):Promise<PlanStop[]> {
  const start=date(input.trip.startDate),end=date(input.trip.endDate);dayCount(start,end);
  const days=input.days as Data[];check(Array.isArray(days)&&days.length>0&&days.length<=366,'INVALID_INPUT','Plan days required');
  check(days.every((d,i)=>date(d.date)>=start&&d.date<=end&&(!i||d.date>days[i-1].date)),'INVALID_INPUT','Plan dates must be unique, ordered and inside trip range');
  const flat=days.flatMap(d=>(d.stops as Data[]).map((s,position)=>({...s,date:d.date,position}))) as PlanStop[];
  check(flat.length>0&&flat.length<=100,'INVALID_INPUT','Plan requires 1-100 stops');
  check(flat.every((s,i)=>Boolean(s.candidateId)!==Boolean(s.stopId)&&(i===flat.length-1?!s.transportToNext:!!s.transportToNext)),'INVALID_INPUT','Use one place reference per stop and transport on every outgoing segment');
  const existingIds=flat.filter(s=>s.stopId).map(s=>s.stopId!);check(new Set(existingIds).size===existingIds.length,'INVALID_INPUT','Duplicate existing stop');
  if(input.tripId){
   check(Number.isInteger(input.expectedRevision),'INVALID_INPUT','Existing trip requires expectedRevision');
   const current=await options.service.execute('get_trip',{tripId:input.tripId});
   check(current.revision===input.expectedRevision,'REVISION_CONFLICT','Trip changed before plan execution');
   const ids=new Set(current.trip.stops.map((s:Data)=>s.id));
   check(existingIds.every(id=>ids.has(id)),'STOP_NOT_FOUND','Existing stop is not in target trip');
   check(ids.size===existingIds.length,'PLAN_OMITS_EXISTING_STOPS','Include all existing stopIds; remove stops only with explicit low-level deletion');
  }else check(existingIds.length===0&&!input.expectedRevision,'INVALID_INPUT','New trips require candidate references');
  validatePlanReview(days,input.review);
  // Freeze only server-registered candidates, before long-running visible steps can expire.
  return flat.map(s=>s.candidateId?{...s,place:place(options.resolveCandidate(s.candidateId))}:s);
 }
 function steps(job:Job){
  const result=[{key:'metadata',label:job.tripId?'更新行程信息':'创建行程'}];
  job.stops.forEach((s,i)=>result.push({key:`stop:${i}`,label:`录入地点 ${i+1}/${job.stops.length}`}));
  job.stops.slice(0,-1).forEach((s,i)=>result.push({key:`transport:${i}`,label:`设置交通 ${i+1}/${job.stops.length-1}`}));
  if(job.input.calculateRoutes)result.push({key:'routes',label:'计算并展示路线'});
  result.push({key:'verify',label:'核验地点顺序和交通'},{key:'finish',label:job.input.finish==='play'&&job.stops.length>1?'打开并播放行程':'展示行程地图'});return result;
 }
 async function prepare(job:Job,key:string):Promise<SavedStep>{
  const requestId=`${job.taskId}:${key}`;
  if(key==='metadata')return job.input.tripId?{key,name:'update_trip',input:{tripId:job.input.tripId,expectedRevision:job.input.expectedRevision,requestId,patch:job.input.trip}}:{key,name:'create_trip',input:{...job.input.trip,requestId}};
  const current=await readTrip(job);
  check(current.revision===job.revision,'REVISION_CONFLICT','Trip changed during plan task');
  if(key==='routes')return {key,name:'calculate_routes',input:{tripId:job.tripId,expectedRevision:job.revision,requestId}};
  const [kind,rawIndex]=key.split(':'),index=Number(rawIndex),stop=job.stops[index];
  let op:Data;
  if(kind==='stop'){
   const day=current.trip.days.find((d:Data)=>d.date===stop.date);check(day,'INVALID_INPUT','Plan day is missing');
   op=stop.stopId?{op:'move_stop',stopId:stop.stopId,targetDayId:day.id,position:stop.position}:{op:'add_stop',dayId:day.id,position:stop.position,place:stop.place};
  }else op={op:'set_transport',fromStopId:stop.stopId,toStopId:job.stops[index+1].stopId,transport:stop.transportToNext};
  return {key,name:'edit_itinerary',input:{tripId:job.tripId,expectedRevision:job.revision,requestId,operations:[op]}};
 }
 async function verify(job:Job){
  const {trip,revision}=await readTrip(job);check(revision===job.revision,'REVISION_CONFLICT','Trip changed before verification');
  check(trip.stops.length===job.stops.length&&trip.stops.every((s:Data,i:number)=>s.id===job.stops[i].stopId&&trip.days.find((d:Data)=>d.id===s.dayId)?.date===job.stops[i].date),'PLAN_VERIFICATION_FAILED','Saved stop order does not match plan');
  check(trip.segments.every((s:Data,i:number)=>s.transport===job.stops[i].transportToNext),'PLAN_VERIFICATION_FAILED','Saved transport does not match plan');
 }
 async function run(job:Job){
  const activityId=activity.start({viewId:job.input.viewId,kind:'plan',title:job.input.trip.name,step:{index:job.completed,total:job.total,label:job.label}});
  try{
   if(job.tripId)await options.service.claimPlanTask(job.taskId,job.tripId);
   const sequence=steps(job);
   while(job.completed<sequence.length){
    const step=sequence[job.completed];job.label=step.label;
    activity.update(activityId,{step:{index:job.completed+1,total:job.total,label:step.label},message:step.label});
    await options.assertView(job.input.viewId);
    if(step.key==='verify')await verify(job);
    else if(step.key==='finish'){
     await verify(job);
     await options.finish({tripId:job.tripId!,revision:job.revision!,viewId:job.input.viewId,finish:job.input.finish,stops:job.stops,base:job.base});
     await verify(job);
    }else{
     if(!job.current){job.current=await prepare(job,step.key);await save(job);}
     const prepared=job.current;
     if(!prepared.saved){
      // Request ID + immutable prepared arguments make crash-after-commit retries idempotent.
      const result=await options.service.execute(prepared.name,prepared.input,'web',{retainRequest:true});
      prepared.saved={tripId:result.tripId,revision:result.revision,...(result.results?{results:result.results}:{}),...(result.routes?{routes:result.routes}:{})};
      job.tripId=result.tripId;job.revision=result.revision;
      await options.service.claimPlanTask(job.taskId,result.tripId);
      if(step.key.startsWith('stop:')){
       const stop=job.stops[Number(step.key.split(':')[1])];
       if(!stop.stopId)stop.stopId=result.results.find((r:Data)=>r.op==='add_stop')?.stopId;
      }
      await save(job);
     }
     const saved=prepared.saved;
     // A different editor must not be overwritten by replaying an old task result.
     const fresh=await readTrip(job);check(fresh.revision===saved.revision,'REVISION_CONFLICT','Trip changed while task display was interrupted');
     await options.present(prepared.name,{...saved,trip:fresh.trip},job.input.viewId,`${prepared.input.requestId}:show:${job.attempt}`,job.base);
     if(step.key.startsWith('stop:')){const stop=job.stops[Number(step.key.split(':')[1])];if(stop.candidateId)options.adopted?.(stop.candidateId,job.input.viewId);}
    }
    job.completed++;job.current=undefined;await save(job);
   }
   job.status='completed';job.label='计划已展示';job.error=undefined;await save(job);
   await options.service.releaseTaskReceipts(job.taskId).catch(()=>{});
   activity.update(activityId,{status:'completed',message:job.label,step:{index:job.total,total:job.total,label:job.label}});
  }catch(error){job.status='failed';job.error=safeError(error);await save(job);activity.update(activityId,{status:'failed',error:job.error.message,message:`停在：${job.label}`});}finally{if(job.status==='completed'||job.status==='failed'&&!isRecoverablePlanError(job.error?.code))await options.service.releasePlanTask(job.taskId,job.tripId);}
 }
 return {
  async apply(raw:Data,base:string){
   const input:Data={...raw,finish:raw.finish??'play',calculateRoutes:raw.calculateRoutes??true};
   const taskId=`plan_${digest(input.requestId).slice(0,32)}`;
   const {viewId:_view,...identity}=input;const fingerprint=digest(stable(identity));
   const previous=locks.get(taskId)??Promise.resolve();
   const operation=previous.catch(()=>{}).then(async()=>{
    let job=await load(taskId);
    if(job)check(job.fingerprint===fingerprint,'REQUEST_ID_REUSED','Use the same confirmed plan to resume');
    if(job&&running.has(taskId))return summary(job);
    if(job?.status==='completed'){await options.service.releasePlanTask(job.taskId,job.tripId);await options.service.releaseTaskReceipts(job.taskId).catch(()=>{});return summary(job);}
    await options.assertView(input.viewId);
    if(!job){const stops=await validate(input);job={taskId,fingerprint,input,base,status:'running',tripId:input.tripId,revision:input.expectedRevision,stops,completed:0,total:0,label:'准备执行',attempt:0,updatedAt:Date.now()};job.total=steps(job).length;}
    job.input.viewId=input.viewId;job.status='running';job.error=undefined;job.attempt++;await save(job);
    const task=run(job).finally(()=>running.delete(taskId));running.set(taskId,task);void task.catch(()=>{});
    return summary(job);
   });
   locks.set(taskId,operation);try{return await operation;}finally{if(locks.get(taskId)===operation)locks.delete(taskId);}
  },
  async get(taskId:string,waitMs=15000){
   check(Number.isInteger(waitMs)&&waitMs>=0&&waitMs<=20000,'INVALID_INPUT','waitMs must be 0-20000');
   let job=await load(taskId);check(job,'TASK_NOT_FOUND','Plan task not found');
   const task=running.get(taskId);
   if(task&&waitMs){let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([task,new Promise<void>(resolve=>{timer=setTimeout(resolve,waitMs);})]);if(timer)clearTimeout(timer);job=(await load(taskId))!;}
   if(job.status==='running'&&!running.has(taskId)){
    const previous=locks.get(taskId)??Promise.resolve();
    const transition=previous.catch(()=>{}).then(async()=>{
     const fresh=(await load(taskId))!;
     if(fresh.status==='running'&&!running.has(taskId)){fresh.status='failed';fresh.error={code:'TASK_INTERRUPTED',message:'服务重启中断了任务，请用相同 requestId 和计划恢复'};await save(fresh);}
     return summary(fresh);
    });
    locks.set(taskId,transition);try{return await transition;}finally{if(locks.get(taskId)===transition)locks.delete(taskId);}
   }
   return summary(job);
  },
 };
}
