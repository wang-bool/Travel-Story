import test from 'node:test';import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../mcp/server.mjs';
import {createBridgeRuntime} from '../mcp/bridgeRuntime.mjs';
test('SDK client discovers 16 tools, calls validated tools and sees service errors',async()=>{
 const calls=[];const server=createMcpServer(async(name,input)=>{calls.push({name,input});if(name==='get_trip')throw Object.assign(new Error('missing'),{code:'TRIP_NOT_FOUND'});return {version:'0.2.0',search:{configured:false},connectedViews:0,capabilities:{mcp:true}};});
 const [a,b]=InMemoryTransport.createLinkedPair();const client=new Client({name:'travel-test',version:'1'});
 await Promise.all([server.connect(a),client.connect(b)]);
 try{const tools=await client.listTools();assert.equal(tools.tools.length,16);const status=await client.callTool({name:'get_status',arguments:{}});assert.equal(status.structuredContent.version,'0.2.0');const missing=await client.callTool({name:'get_trip',arguments:{tripId:'missing'}});assert.equal(missing.isError,true);assert.equal(JSON.parse(missing.content[0].text).error.code,'TRIP_NOT_FOUND');const invalid=await client.callTool({name:'edit_itinerary',arguments:{tripId:'x',expectedRevision:1,requestId:'r',operations:[{op:'add_stop',dayId:'d',place:{latitude:0}}]}});assert.equal(invalid.isError,true);assert.equal(calls.length,2);}finally{await client.close();await server.close();}
});

test('SDK exposes old-app compatibility and reports a blocked mutation as a business error',async()=>{
 const calls=[];const runtime=createBridgeRuntime({lifecycle:{},request:async name=>{calls.push(name);return {version:'0.2.0',search:{configured:true},connectedViews:1,capabilities:{mcp:true,manualEditing:true}};}});
 const server=createMcpServer((name,input)=>runtime.call(name,input));
 const [a,b]=InMemoryTransport.createLinkedPair();const client=new Client({name:'compatibility-test',version:'1'});
 await Promise.all([server.connect(a),client.connect(b)]);
 try{
  const status=await client.callTool({name:'get_status',arguments:{}});assert.equal(status.isError,undefined);assert.equal(status.structuredContent.compatibility.status,'restart_required');
  const create=await client.callTool({name:'create_trip',arguments:{requestId:'never-save',name:'Never save',startDate:'2026-11-06',endDate:'2026-11-06'}});
  assert.equal(create.isError,true);assert.equal(JSON.parse(create.content[0].text).error.code,'SERVICE_VERSION_MISMATCH');assert.deepEqual(calls,['get_status']);
 }finally{await client.close();await server.close();}
});
