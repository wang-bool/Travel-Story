import test from 'node:test';import assert from 'node:assert/strict';
test('committed create remains successful if subsequent refresh fails',async()=>{
 const store=await import('../lib/store.ts');
 const old={fetch:globalThis.fetch,window:globalThis.window,localStorage:globalThis.localStorage,EventSource:globalThis.EventSource};
 globalThis.window={};globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.EventSource=class{constructor(){}};
 let reads=0;globalThis.fetch=async(url)=>{if(url==='/api/trips'){reads++;if(reads>1)throw new Error('offline after commit');return Response.json({trips:[],initialized:true});}return Response.json({tripId:'trip_test',revision:1,trip:{id:'trip_test',name:'Saved',revision:1,days:[],stops:[],segments:[]}});};
 try{const trip=await store.createTrip({name:'Saved',startDate:'2026-11-01',endDate:'2026-11-01'});assert.equal(trip.id,'trip_test');assert.equal(store.getSnapshot()[0].id,'trip_test');assert.match(store.getSyncStatus().error,/已保存/);}finally{for(const [k,v] of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
test('unimported legacy browser data survives synchronization to a nonempty server',async()=>{
 const store=await import('../lib/store.ts?legacy-preservation');const old={fetch:globalThis.fetch,window:globalThis.window,localStorage:globalThis.localStorage,EventSource:globalThis.EventSource};const legacy=JSON.stringify({trips:[{id:'old_browser',name:'Unimported'}]});const storage=new Map([['travel-story:v1',legacy]]);globalThis.window={};globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};globalThis.EventSource=class{};globalThis.fetch=async()=>Response.json({initialized:true,trips:[{id:'new_mcp'}]});try{await store.whenSynced();assert.equal(storage.get('travel-story:legacy-backup'),legacy);assert.equal(JSON.parse(storage.get('travel-story:v1')).trips[0].id,'new_mcp');}finally{for(const [k,v] of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
