/** Coordinate app startup without delaying the stdio initialize/tools-list handshake. */
export function createBridgeRuntime({ lifecycle, request, autoStart = false, onStartup = () => {}, onStartupError = () => {} }) {
  let startup, pending = false, compatibility, statusPending;
  const requiredCapabilities=['planTasks','searchActivity','planReview'];
  const writes=new Set(['apply_plan','create_trip','update_trip','edit_itinerary','delete_trip','calculate_routes','open_trip','control_view']);
  const mismatchMessage='Travel Story MCP and the running web app are incompatible. Restart the web app from the updated project, reconnect MCP, then call get_status. ensure_service only reuses/starts the app; it does not upgrade an old process. Do not fall back to create_trip/edit_itinerary, HTTP API, or browser form entry to bypass this error.';
  const mismatch=()=>Object.assign(new Error(mismatchMessage),{code:'SERVICE_VERSION_MISMATCH'});
  async function remote(name,args){
    try{return await request(name,args);}
    catch(error){
      if(error.code==='UNKNOWN_TOOL'){
        compatibility={status:'restart_required',requiredCapabilities,missingTool:name,message:mismatchMessage};
        throw mismatch();
      }
      // The process at this address may be replaced while disconnected. Never
      // retry this call; require fresh capability evidence for the next write.
      if(error.code==='SERVICE_UNAVAILABLE')compatibility=undefined;
      throw error;
    }
  }
  async function readStatus(){
    const result=await remote('get_status',{});
    const missingCapabilities=requiredCapabilities.filter(key=>result.capabilities?.[key]!==true);
    compatibility=missingCapabilities.length?{status:'restart_required',requiredCapabilities,missingCapabilities,message:mismatchMessage}:{status:'compatible',requiredCapabilities};
    return {...result,compatibility};
  }
  async function requireCompatible(){
    if(!compatibility){
      statusPending??=readStatus().finally(()=>{statusPending=undefined;});
      await statusPending;
    }
    if(compatibility.status!=='compatible')throw mismatch();
  }
  function boot() {
    if (pending) return startup;
    pending = true;
    // Store failures as outcomes so an idle client never creates an unhandled rejection.
    startup = Promise.resolve().then(() => lifecycle.ensure()).then(value => {
      pending = false;
      onStartup(value);
      return { value };
    }, error => {
      pending = false;
      onStartupError(error);
      return { error };
    });
    return startup;
  }
  async function checked(task) {
    const outcome = await task;
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }
  return {
    start() {
      return autoStart ? (startup ?? boot()) : Promise.resolve();
    },
    async call(name, args) {
      if (name === 'ensure_service') {const result=await checked(boot());compatibility=undefined;return result;}
      if (autoStart) await checked(startup ?? boot());
      if(name==='get_status')return readStatus();
      if(writes.has(name))await requireCompatible();
      return remote(name, args);
    },
  };
}
