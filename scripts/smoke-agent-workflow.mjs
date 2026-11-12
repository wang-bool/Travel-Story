// Exercise real MCP, per-view SSE UI, and durable workflow against disposable fixture data.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const dir=process.env.TRAVEL_STORY_DATA_DIR,base=process.env.TRAVEL_STORY_URL;
assert.ok(dir?.startsWith('/tmp/travel-story-mcp.')&&base,'Use an isolated fixture server');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){const r=await fn();if(r)return r;await sleep(100);}throw Error('Timed out: '+label);}
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../mcp/start.mjs',import.meta.url))],env:{...process.env,TRAVEL_STORY_URL:base},stderr:'inherit'});
const client=new Client({name:'agent-workflow-browser-smoke',version:'1'});
let chrome,ws,id=0;const pending=new Map(),exceptions=[],seenSteps=new Set();
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method));},30000);pending.set(n,{resolve:r=>{clearTimeout(timer);resolve(r);},reject});ws.send(JSON.stringify({id:n,method,params}));});
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
const tool=async(name,args={})=>{const r=await client.callTool({name,arguments:args},undefined,{timeout:60000});assert.notEqual(r.isError,true,JSON.stringify(r.content));return r.structuredContent;};
try{
 await client.connect(transport);assert.equal((await client.listTools()).tools.length,16);
 const status=await tool('get_status');assert.equal(new URL(status.url).origin,new URL(base).origin);assert.ok(Array.isArray(status.views));assert.equal(status.compatibility.status,'compatible');assert.equal(status.capabilities.planReview,true);
 const profile=path.join(dir,'workflow-chrome-'+Date.now());await mkdir(profile);
 chrome=spawn('google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:'ignore'});
 const port=await until(async()=>{try{return Number((await readFile(profile+'/DevToolsActivePort','utf8')).split('\n')[0]);}catch{return false;}},'Chrome');
 const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const m=JSON.parse(String(e.data));if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails);else if(m.method==='Fetch.requestPaused'){
 const {requestId,request}=m.params,planet=new URL(request.url).pathname==='/api/tiles/planet';const body=planet?JSON.stringify({tilejson:'3.0.0',tiles:[base+'/api/tiles/smoke/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom:0,vector_layers:[]}):'';
 void call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:planet?'application/json':'application/x-protobuf'}],body:Buffer.from(body).toString('base64')}).catch(()=>{});
 }};
 await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*/api/tiles/*'}]});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 const nav=await call('Page.navigate',{url:base});assert.ok(!nav.errorText);await until(()=>ev('!!document.querySelector(".hero-stage")'),'rendered home');
 const view=await until(async()=>(await tool('get_view_state')).views.find(v=>v.page==='home'&&v.ready),'home bridge');
 const viewId=view.viewId;
 assert.equal(await ev('!!document.querySelector(".agent-search-panel")'),false,'No search panel before a real MCP search');
 const query={query:'__TRAVEL_STORY_SMOKE_PLACE__',countryCode:'FR',city:'Paris',viewId,limit:5};
 const first=await tool('search_places',query);assert.ok(first.candidates.length);
 await until(()=>ev('document.querySelector(".agent-search-panel")?.textContent.includes("__TRAVEL_STORY_SMOKE_PLACE__")'),'search input shown');
 assert.ok(await ev('document.querySelector(".agent-search-panel")?.textContent.includes("联调新增地点")'),'real returned candidate shown');
 const cached=await tool('search_places',query);assert.equal(cached.cached,true);assert.equal(cached.candidates[0].candidateId,first.candidates[0].candidateId,'valid candidates reused');
 await until(()=>ev('document.querySelector(".agent-search-panel")?.textContent.includes("缓存命中")'),'cache status visible');
 await writeFile(path.join(dir,'agent-search-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await ev('document.querySelector(".agent-search-panel-actions button").click()');assert.equal(await ev('document.querySelector(".agent-search-panel").classList.contains("is-expanded")'),false);
 await ev('document.querySelector(".agent-search-panel-trigger").click()');
 const plan={requestId:crypto.randomUUID(),viewId,trip:{name:'Agent 一次提交 · 联动验证 '+Date.now(),startDate:'2026-11-06',endDate:'2026-11-06'},days:[{date:'2026-11-06',stops:[{candidateId:first.candidates[0].candidateId,transportToNext:'car'},{candidateId:cached.candidates[0].candidateId}]}],review:{spatialNotes:'同一测试地点，无真实旅行约束。',days:[{date:'2026-11-06',availableMinutes:480,travelMinutes:60,visitMinutes:180,mealRestMinutes:90,bufferMinutes:60,basis:'联调夹具预算，非真实旅行数据。'}]},finish:'play'};
 const overfull=structuredClone(plan);overfull.review.days[0].availableMinutes=30;
 const rejected=await client.callTool({name:'apply_plan',arguments:overfull});assert.equal(rejected.isError,true);assert.equal(JSON.parse(rejected.content[0].text).error.code,'PLAN_TIME_EXCEEDED');
 assert.equal((await tool('list_trips',{query:plan.trip.name})).trips.length,0,'an overfull plan creates no trip');
 // Watch actual DOM progress while MCP's server-side task advances independently.
 await ev(`window.__workflowSteps=[];window.__workflowObserver=new MutationObserver(()=>{const text=document.querySelector('.agent-search-panel-step')?.textContent;if(text&&!window.__workflowSteps.includes(text))window.__workflowSteps.push(text);});window.__workflowObserver.observe(document.body,{childList:true,subtree:true,characterData:true});`);
 const submitted=await tool('apply_plan',plan);assert.ok(submitted.taskId);
 let end=submitted,waitCalls=0;
 while(end.status==='running'&&waitCalls<15){waitCalls++;end=await tool('get_plan_task',{taskId:submitted.taskId,waitMs:20000});}
 assert.equal(end.status,'completed',JSON.stringify(end));assert.equal(end.progress.completed,end.progress.total);
 const saved=await tool('get_trip',{tripId:end.tripId});assert.equal(saved.trip.stops.length,2);assert.equal(saved.trip.segments[0].transport,'car');
 const playing=(await tool('get_view_state',{viewId})).views[0];assert.equal(playing.page,'play');assert.equal(playing.tripId,end.tripId);
 assert.ok(await ev('!!document.querySelector(".agent-search-panel")'),'global panel persists through home/plan/play');
 assert.ok(await ev('document.querySelector(".agent-search-panel")?.textContent.includes("计划执行进度")'));
 const steps=await ev('window.__workflowSteps');assert.ok(steps.length>=3,JSON.stringify(steps));
 const repeat=await tool('apply_plan',plan);assert.equal(repeat.taskId,end.taskId);assert.equal(repeat.status,'completed');
 const trips=await tool('list_trips',{query:plan.trip.name});assert.equal(trips.trips.length,1,'resubmitting completed task does not duplicate data');
 await ev('document.querySelector(".agent-search-panel-history-toggle").click()');
 await ev(`Array.from(document.querySelectorAll('.agent-search-panel-history button')).find(button=>button.textContent.includes('__TRAVEL_STORY_SMOKE_PLACE__')).click()`);
 assert.ok(await ev('document.querySelector(".agent-search-panel-adopted")?.textContent.includes("已采用")'),'search history marks the adopted candidate');
 await ev(`Array.from(document.querySelectorAll('.agent-search-panel-history button')).find(button=>button.textContent.includes('Agent 一次提交')).click()`);
 await ev('document.querySelector(".agent-search-panel-history-toggle").click()');
 await tool('control_view',{viewId,action:'stop'});
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await sleep(300);
 const bounds=await ev(`(()=>{const r=document.querySelector('.agent-search-panel').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
 assert.ok(bounds.left>=0&&bounds.right<=bounds.width+1&&bounds.top>=0&&bounds.bottom<=bounds.height+1,JSON.stringify(bounds));
 await writeFile(path.join(dir,'agent-task-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.equal(exceptions.length,0,JSON.stringify(exceptions));
 const report={ok:true,tripId:end.tripId,taskId:end.taskId,taskCalls:1+waitCalls,progressSnapshots:steps,checks:['compatible live app','overfull plan rejected without trip creation','authenticated direct MCP requests','search inputs/results/cache visible','valid candidate ID reuse','collapse and expand','one plan submission drives visible writes and playback','global UI persists across routes','completed request is idempotent','adopted candidate visible in search history','mobile panel bounded','zero runtime exceptions'],screenshots:[path.join(dir,'agent-search-desktop.png'),path.join(dir,'agent-task-mobile.png')]};
 await writeFile(path.join(dir,'agent-workflow-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{ws?.close();chrome?.kill('SIGTERM');await client.close();}
