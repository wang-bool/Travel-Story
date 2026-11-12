'use client';
import {createContext, useContext, useEffect, useRef, useState} from 'react';
import {usePathname, useRouter} from 'next/navigation';
import {appRoute} from '@/lib/appNavigation';
import {getAppHost} from '@/lib/appHost';
import {createAppAgentRuntime, type AppAgentRuntime} from '@/lib/appAgentRuntime';
import {getTrip, refreshTrips} from '@/lib/store';
import type {ViewCommand} from '@/lib/server/viewRegistry';
export interface AppBridgeState {viewId:string|null;connected:boolean;error:string|null}
interface BridgeContext {runtime:AppAgentRuntime;state:AppBridgeState}
const Context=createContext<BridgeContext|null>(null);
export const useAppAgentBridge=()=>useContext(Context);
async function post(input:unknown,keepalive=false){
 const response=await fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),keepalive});
 const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'应用连接失败');return result;
}
/** One lease and serialized queue for the lifetime of this application window. */
export function AppAgentBridge({children}:{children:React.ReactNode}){
 const pathname=usePathname();const router=useRouter();
 const route=useRef(appRoute(pathname));route.current=appRoute(pathname);
 const routerRef=useRef(router);routerRef.current=router;
 const [viewId]=useState(()=>crypto.randomUUID());
 const [runtime]=useState(()=>createAppAgentRuntime({
  route:()=>route.current,navigate:target=>{routerRef.current.push(target.href);},
  refresh:refreshTrips,read:getTrip,reveal:()=>getAppHost().reveal(),
 }));
 const leaseGeneration=useRef(0);
 const [state,setState]=useState<AppBridgeState>({viewId:null,connected:false,error:null});
 useEffect(()=>{
  runtime.resume();
  const generation=++leaseGeneration.current;
  const launchId=new URLSearchParams(window.location.search).get('openCommandId')||undefined;
  let disposed=false,polling=false,executing=false;
  const consumed=new Set<string>();const queue:ViewCommand[]=[];
  const update=(patch:Partial<AppBridgeState>)=>{if(!disposed)setState(previous=>({...previous,...patch}));};
  update({viewId});
  const ack=(command:ViewCommand,status:string,error?:string)=>post({op:'ack',viewId,commandId:command.commandId,status,error});
  const drain=async()=>{
   if(executing||disposed)return;executing=true;
   try{while(!disposed&&queue.length){
    const command=queue.shift()!;
    if(command.expiresAt<=Date.now())continue;
    try{
     await ack(command,'running');if(disposed)break;
     await runtime.execute({...command,tripId:command.tripId??''});
     if(!disposed){await ack(command,'completed');update({error:null});}
    }catch(error){const message=error instanceof Error?error.message:'应用操作失败';update({error:message});
     if(!disposed)await ack(command,'failed',message).catch(()=>{});
    }
   }}finally{executing=false;}
  };
  const heartbeat=async()=>{
   if(polling||disposed)return;polling=true;
   try{
    const page=runtime.view();
    const result=await post({op:'heartbeat',view:{...page,viewId,launchId,appBridge:true,host:getAppHost().kind,
     revision:page.tripId?getTrip(page.tripId)?.revision:undefined,
     visibility:document.visibilityState==='visible'?'visible':'hidden',focused:document.hasFocus(),
    }});
    if(disposed){if(leaseGeneration.current===generation)await post({op:'remove',viewId},true).catch(()=>{});return;}
    const local=page.tripId?getTrip(page.tripId):null;
    if((typeof result.tripRevision==='number'&&result.tripRevision>(local?.revision??-1))||(result.tripRevision===null&&local))await refreshTrips();
    if(disposed)return;
    update({connected:true});
    for(const command of (result.commands??[]) as ViewCommand[]){
     if(consumed.has(command.commandId))continue;
     consumed.add(command.commandId);queue.push(command);
    }
    while(consumed.size>2048)consumed.delete(consumed.values().next().value!);
    void drain();
   }catch(error){update({connected:false,error:error instanceof Error?error.message:'应用连接失败'});}
   finally{polling=false;}
  };
  void heartbeat();
  const interval=setInterval(()=>{void heartbeat();},1000);
  const refresh=()=>{void heartbeat();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{disposed=true;runtime.dispose();clearInterval(interval);queue.length=0;
   window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);
   queueMicrotask(()=>{if(leaseGeneration.current===generation)void post({op:'remove',viewId},true).catch(()=>{});});
  };
 },[runtime,viewId]);
 return <Context.Provider value={{runtime,state}}>{children}</Context.Provider>;
}
