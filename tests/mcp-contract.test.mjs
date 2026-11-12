import test from 'node:test';
import assert from 'node:assert/strict';
import { toolDefinitions,validateTool } from '../mcp/tools.mjs';
test('17 tools are discoverable with strict edit schemas',()=>{assert.equal(toolDefinitions.length,17);assert.throws(()=>validateTool('edit_itinerary',{tripId:'t',expectedRevision:1,requestId:'r',operations:[{op:'add_stop',dayId:'d',place:{name:'invented'}}]}),e=>e.code==='INVALID_INPUT');assert.throws(()=>validateTool('control_view',{viewId:'v',action:'pause'}));});
test('set_weather accepts a forecast day or null and rejects bad effects',()=>{
 const input={tripId:'t',expectedRevision:1,requestId:'r',operations:[{op:'set_weather',dayId:'d',weather:{label:'晴转多云',low:8,high:17,effect:'sun'}},{op:'set_weather',dayId:'d',weather:null}]};
 assert.deepEqual(validateTool('edit_itinerary',input),input);
 assert.throws(()=>validateTool('edit_itinerary',{tripId:'t',expectedRevision:1,requestId:'r',operations:[{op:'set_weather',dayId:'d',weather:{label:'晴',effect:'hail'}}]}),e=>e.code==='INVALID_INPUT');
});
test('get_weather requires coordinates or city and a bounded date range',()=>{
 assert.deepEqual(validateTool('get_weather',{latitude:31.2,longitude:121.5,startDate:'2026-11-12',endDate:'2026-11-14'}),{latitude:31.2,longitude:121.5,startDate:'2026-11-12',endDate:'2026-11-14'});
 assert.deepEqual(validateTool('get_weather',{city:'上海',startDate:'2026-11-12',endDate:'2026-11-12'}),{city:'上海',startDate:'2026-11-12',endDate:'2026-11-12'});
 assert.throws(()=>validateTool('get_weather',{latitude:31.2,startDate:'2026-11-12',endDate:'2026-11-14'}),e=>e.code==='INVALID_INPUT');
 assert.throws(()=>validateTool('get_weather',{city:'上海',startDate:'2026-11-14',endDate:'2026-11-12'}),e=>e.code==='INVALID_INPUT');
 assert.throws(()=>validateTool('get_weather',{city:'上海',startDate:'2026-11-01',endDate:'2026-11-20'}),e=>e.code==='INVALID_INPUT');
 const tool=toolDefinitions.find(t=>t.name==='get_weather');
 assert.equal(tool.annotations.readOnlyHint,true);
});
test('valid candidate operation and date mutation are preserved',()=>{const input={tripId:'t',expectedRevision:1,requestId:'r',operations:[{op:'add_stop',dayId:'d',candidateId:'c',clientRef:'first'},{op:'set_transport',fromStopId:'first',toStopId:'existing',transport:'walk'}]};assert.deepEqual(validateTool('edit_itinerary',input),input);});

test('ensure_service has fixed empty input and reports launch versus reuse',()=>{
 assert.deepEqual(validateTool('ensure_service',{}),{});
 assert.throws(()=>validateTool('ensure_service',{command:'arbitrary'}),e=>e.code==='INVALID_INPUT');
 const tool=toolDefinitions.find(t=>t.name==='ensure_service');
 assert.equal(tool.annotations.readOnlyHint,false);
 assert.deepEqual(tool.outputSchema.parse({status:'running',url:'http://localhost:3000',launched:false}),{status:'running',url:'http://localhost:3000',launched:false});
});
