import assert from 'node:assert/strict';
import test from 'node:test';
import { searchForAgent, resolveCandidate, getSearchStatus } from '../lib/server/placeSearch.ts';

test('search distinguishes missing configuration from successful empty search', async () => {
  delete process.env.GAODE_KEY; delete process.env.LOCATIONIQ_KEY;
  assert.equal(getSearchStatus().configured, false);
  const result = await searchForAgent({query: 'test-no-config'});
  assert.equal(result.status, 'not_configured');
});
test('search preserves source fields, applies context, and registers stable candidates', async () => {
  process.env.LOCATIONIQ_KEY='test';
  const original=globalThis.fetch;
  const urls=[];
  globalThis.fetch=async url=> {urls.push(new URL(url)); return Response.json([{place_id:42,name:'Notre-Dame',display_name:'Notre-Dame, Paris, France',lat:'48.85',lon:'2.35',class:'amenity',type:'place_of_worship',namedetails:{'name:fr':'Notre-Dame de Paris'},address:{city:'Paris',country:'France',country_code:'fr'}}]);};
  try {
    const result=await searchForAgent({query:'unique-notre-dame',countryCode:'FR',city:'Paris',language:'fr',near:{latitude:48.85,longitude:2.35},limit:3});
    assert.equal(result.status,'ok');
    assert.equal(urls[0].searchParams.get('countrycodes'),'fr');
    assert.equal(urls[0].searchParams.get('accept-language'),'fr');
    assert.match(urls[0].searchParams.get('q'), /Paris/);
    assert.equal(result.candidates[0].provider,'locationiq');
    assert.equal(result.candidates[0].aliases['name:fr'],'Notre-Dame de Paris');
    assert.equal(resolveCandidate(result.candidates[0].candidateId).latitude,48.85);
    assert.throws(()=>resolveCandidate('missing'),e=>e.code==='CANDIDATE_EXPIRED');
  } finally {globalThis.fetch=original;delete process.env.LOCATIONIQ_KEY;}
});
test('provider failures are not reported as empty successful results', async()=>{
 process.env.LOCATIONIQ_KEY='test'; const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw new Error('offline');};
 try {const r=await searchForAgent({query:'failed-query'});assert.equal(r.status,'failed');assert.equal(r.providerStatus.find(x=>x.provider==='locationiq').status,'failed');}
 finally {globalThis.fetch=original;delete process.env.LOCATIONIQ_KEY;}
});
test('domestic-only configuration cannot silently search foreign country',async()=>{
 process.env.GAODE_KEY='test';delete process.env.LOCATIONIQ_KEY;
 try {const r=await searchForAgent({query:'Paris-unavailable',countryCode:'FR'});assert.equal(r.status,'not_configured');assert.equal(r.providerStatus.find(x=>x.provider==='gaode').status,'not_applicable');}
 finally{delete process.env.GAODE_KEY;}
});
test('invalid Gaode coordinates never become candidates',async()=>{
 process.env.GAODE_KEY='test';const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({status:'1',pois:[{id:'bad',name:'Broken',location:'not-a-number,31'},{id:'range',name:'Outside',location:'999,31'},{id:'valid',name:'Shanghai',location:'121.47,31.23'}]});
 try {const r=await searchForAgent({query:'gaode-coordinate-validation'});assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].providerPlaceId,'valid');}
 finally{globalThis.fetch=original;delete process.env.GAODE_KEY;}
});
test('successful not-found differs from outage and context changes bypass cache',async()=>{
 process.env.LOCATIONIQ_KEY='test';const original=globalThis.fetch;const queries=[];
 globalThis.fetch=async url=>{queries.push(new URL(url).searchParams.get('q'));return new Response('{}',{status:404});};
 try {
  const a=await searchForAgent({query:'context-empty',city:'Paris'});
  const b=await searchForAgent({query:'context-empty',city:'London'});
  assert.equal(a.status,'ok');assert.equal(b.status,'ok');assert.deepEqual(queries,['context-empty, Paris','context-empty, London']);
 }finally{globalThis.fetch=original;delete process.env.LOCATIONIQ_KEY;}
});
test('partial provider success remains usable and exposes failed provider',async()=>{
 process.env.GAODE_KEY='test';process.env.LOCATIONIQ_KEY='test';const original=globalThis.fetch;
 globalThis.fetch=async url=>{if(String(url).includes('amap'))throw new Error('failure');return Response.json([]);};
 try{const r=await searchForAgent({query:'partial-success'});assert.equal(r.status,'partial');assert.equal(r.providerStatus.find(x=>x.provider==='gaode').status,'failed');assert.equal(r.providerStatus.find(x=>x.provider==='locationiq').status,'ok');}
 finally{globalThis.fetch=original;delete process.env.GAODE_KEY;delete process.env.LOCATIONIQ_KEY;}
});
test('empty coordinate tokens are not real zero coordinates',async()=>{
 process.env.GAODE_KEY='test';process.env.LOCATIONIQ_KEY='test';const original=globalThis.fetch;
 globalThis.fetch=async url=>String(url).includes('amap')?Response.json({status:'1',pois:[{id:'empty',name:'Empty',location:','},{id:'space',name:'Space',location:' ,31'}]}):Response.json([{place_id:1,name:'Blank',display_name:'Blank',lat:' ',lon:'2'}]);
 try{const r=await searchForAgent({query:'empty-tokens'});assert.equal(r.candidates.length,0);}finally{globalThis.fetch=original;delete process.env.GAODE_KEY;delete process.env.LOCATIONIQ_KEY;}
});
test('hung region is aborted before fallback and caller abort prevents fallback',async()=>{
 const {searchPlacesDetailed}=await import('../lib/geocode.ts');
 process.env.LOCATIONIQ_KEY='test';const original=globalThis.fetch;const urls=[];let firstSignal;
 globalThis.fetch=async(url,opts)=>{urls.push(String(url));if(urls.length===1){firstSignal=opts.signal;return new Promise(()=>{});}return Response.json([]);};
 try{
  const r=await searchPlacesDetailed({query:'deadline-fallback'},undefined,{attemptTimeoutMs:10,totalTimeoutMs:100});
  assert.equal(r.status,'ok');assert.equal(urls.length,2);assert.equal(firstSignal.aborted,true);assert.match(urls[1],/us1/);
  urls.length=0;const controller=new AbortController();
  globalThis.fetch=async(url,opts)=>{urls.push(String(url));controller.abort();return new Promise(()=>{});};
  await assert.rejects(()=>searchPlacesDetailed({query:'caller-abort'},controller.signal,{attemptTimeoutMs:10,totalTimeoutMs:100}));assert.equal(urls.length,1);
 }finally{globalThis.fetch=original;delete process.env.LOCATIONIQ_KEY;}
});
