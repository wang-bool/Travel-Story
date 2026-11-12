import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSegmentRoute } from '../lib/server/routeCalculation.ts';
const from={latitude:48.85,longitude:2.35};const to={latitude:48.86,longitude:2.36};
test('foreign walking and train never return driving estimates',async()=>{
 for(const t of ['walk','bicycle','train']) {const r=await calculateSegmentRoute(from,to,t);assert.equal(r.quality,'unavailable');assert.equal(r.duration,undefined);assert.equal(r.route,null);}
});
test('symbolic flight has no invented travel duration',async()=>{const r=await calculateSegmentRoute(from,to,'plane');assert.equal(r.quality,'schematic');assert.equal(r.duration,undefined);assert.ok(r.route.coordinates.length>=2);});
test('car uses driving provider and validates its result',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({code:'Ok',routes:[{geometry:{coordinates:[[2.35,48.85],[2.36,48.86]]},distance:1500,duration:200}]});
 try {const r=await calculateSegmentRoute(from,to,'car');assert.equal(r.actualProfile,'driving');assert.equal(r.duration,200);assert.equal(r.quality,'routed');}finally{globalThis.fetch=original;}
});
test('domestic walking uses Gaode walking and no car fallback on failure',async()=>{
 const original=globalThis.fetch;process.env.GAODE_KEY='test';
 const start={latitude:31.23,longitude:121.47},end={latitude:31.24,longitude:121.48};
 let requested='';globalThis.fetch=async url=>{requested=String(url);return Response.json({status:'1',route:{paths:[{distance:'1200',duration:'900',steps:[{polyline:'121.47,31.23;121.48,31.24'}]}]}});};
 try {const r=await calculateSegmentRoute(start,end,'walk');assert.match(requested,/direction\/walking/);assert.equal(r.actualProfile,'walking');assert.equal(r.duration,900);
 globalThis.fetch=async()=>{throw new Error('offline');};const failed=await calculateSegmentRoute(start,end,'walk');assert.equal(failed.quality,'unavailable');assert.equal(failed.duration,undefined);
 }finally{globalThis.fetch=original;delete process.env.GAODE_KEY;}
});
test('invalid route input and malformed provider geometry do not escape validation',async()=>{
 await assert.rejects(()=>calculateSegmentRoute({latitude:NaN,longitude:1},to,'car'),e=>e.code==='INVALID_ARGUMENT');
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({code:'Ok',routes:[{geometry:{coordinates:[[999,48],[2,48]]},distance:20,duration:10}]});
 try{assert.equal((await calculateSegmentRoute(from,to,'car')).quality,'unavailable');}finally{globalThis.fetch=original;}
});
test('Gaode missing metrics and empty polyline tokens never yield routed success',async()=>{
 process.env.GAODE_KEY='test';const original=globalThis.fetch;
 const a={latitude:31.23,longitude:121.47},b={latitude:31.24,longitude:121.48};
 try{
  for(const invalid of [null,'', ' ']){
   globalThis.fetch=async()=>Response.json({status:'1',route:{paths:[{distance:invalid,duration:'900',steps:[{polyline:'121.47,31.23;121.48,31.24'}]}]}});
   assert.equal((await calculateSegmentRoute(a,b,'walk')).quality,'unavailable');
  }
  globalThis.fetch=async()=>Response.json({status:'1',route:{paths:[{distance:'200',duration:'900',steps:[{polyline:',; , '}]}]}});
  assert.equal((await calculateSegmentRoute(a,b,'walk')).quality,'unavailable');
 }finally{globalThis.fetch=original;delete process.env.GAODE_KEY;}
});
