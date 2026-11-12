// Real stdio lifecycle check. Disposable data and a dedicated loopback port only.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const directory=process.env.TRAVEL_STORY_DATA_DIR;
assert.ok(directory?.startsWith('/tmp/travel-story-mcp.'),'Use disposable data');
const base=new URL(process.env.TRAVEL_STORY_URL||'http://127.0.0.1:3101');
assert.ok(['127.0.0.1','localhost'].includes(base.hostname)&&base.port&&base.port!=='3000','Use a dedicated test port');
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../mcp/index.mjs',import.meta.url))],env:{...process.env,TRAVEL_STORY_URL:base.origin},stderr:'inherit'});
const client=new Client({name:'lifecycle-smoke',version:'1'});
let ownedPid;
try{
 await client.connect(transport);
 const offline=await client.callTool({name:'get_status',arguments:{}});
 assert.equal(offline.isError,true,'Dedicated server must be offline before this check');
 const started=await client.callTool({name:'ensure_service',arguments:{}},undefined,{timeout:60000});
 assert.notEqual(started.isError,true,JSON.stringify(started.content));
 assert.equal(started.structuredContent.status,'started');
 assert.equal(started.structuredContent.launched,true);
 ownedPid=started.structuredContent.pid;
 assert.ok(ownedPid);
 const reused=await client.callTool({name:'ensure_service',arguments:{}});
 assert.equal(reused.structuredContent.status,'running');
 assert.equal(reused.structuredContent.launched,false);
 const status=await client.callTool({name:'get_status',arguments:{}});
 assert.equal(status.structuredContent.capabilities.mcp,true);
 console.log(JSON.stringify({ok:true,url:base.origin,checks:['MCP connects while app offline','ensure_service starts authenticated app','already-running service reused','protocol stdout remains valid']},null,2));
}finally{
 await client.close();
 if(ownedPid){try{process.kill(ownedPid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}
}
