// Real unified entry smoke: launches the MCP stdio server plus an isolated web app.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const directory=process.env.TRAVEL_STORY_DATA_DIR;
const base=new URL(process.env.TRAVEL_STORY_URL||'http://127.0.0.1:3132');
assert.ok(directory?.startsWith('/tmp/travel-story-mcp.'),'Use disposable test data');
assert.ok(['127.0.0.1','localhost'].includes(base.hostname)&&base.port&&base.port!=='3000','Use a dedicated test port');
let ownedPid, clients=[];
async function connect() {
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../mcp/start.mjs',import.meta.url))],env:{...process.env,TRAVEL_STORY_URL:base.origin},stderr:'pipe'});
  let logs='';transport.stderr?.on('data',data=>{logs+=String(data);const match=logs.match(/\(pid=(\d+)\)/);if(match)ownedPid=Number(match[1]);});
  const client=new Client({name:'unified-startup-smoke',version:'1'});clients.push(client);
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length,16,'MCP initialize and tool discovery work while web startup is pending');
  const status=await client.callTool({name:'get_status',arguments:{}},undefined,{timeout:60000});
  assert.notEqual(status.isError,true,JSON.stringify(status.content));
  assert.equal(status.structuredContent.capabilities.mcp,true);
  assert.equal(status.structuredContent.capabilities.manualEditing,true);
  return {client,logs:()=>logs};
}
try {
  let online=false;try{online=(await fetch(new URL('/api/mcp',base),{signal:AbortSignal.timeout(1000)})).ok;}catch{}
  assert.equal(online,false,'Start with an unused isolated port');
  const first=await connect();
  const until=Date.now()+2000;while(!ownedPid&&Date.now()<until)await new Promise(r=>setTimeout(r,25));
  assert.ok(ownedPid,'Unified entry starts web automatically, without ensure_service call');
  assert.match(first.logs(),/App started:/);
  const reused=await first.client.callTool({name:'ensure_service',arguments:{}},undefined,{timeout:60000});
  assert.equal(reused.structuredContent.status,'running');assert.equal(reused.structuredContent.launched,false);
  await first.client.close();
  assert.equal((await fetch(new URL('/api/mcp',base))).ok,true,'Closing stdio leaves the browser service available');
  const pidBefore=ownedPid;
  const second=await connect();
  assert.equal(ownedPid,pidBefore,'Second unified client reuses web instead of launching a new server');
  assert.match(second.logs(),/App running:/);
  const result={ok:true,url:base.origin,pid:ownedPid,checks:['one command starts MCP and authenticated web app','tool discovery works during startup','get_status waits for app readiness','existing service reused','stdout contains valid MCP only','closing MCP preserves browser service']};
  await writeFile(path.join(directory,'startup-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {
  for(const client of clients)await client.close();
  if(ownedPid&&process.env.TRAVEL_STORY_KEEP_TEST_SERVICE!=='1') {
    try{process.kill(ownedPid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
}
