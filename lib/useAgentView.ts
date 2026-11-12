'use client';
import {useLayoutEffect,useRef} from 'react';
import {useAppAgentBridge} from '../components/AppAgentBridge';
import type {AgentPageRegistration} from './appAgentRuntime';
export type {ViewCommand} from './server/viewRegistry';
/** Page registration only. The root bridge owns window identity, heartbeat and receipts. */
export function useAgentView(options:AgentPageRegistration){
 const bridge=useAppAgentBridge();const latest=useRef(options);latest.current=options;
 const runtime=bridge?.runtime;
 useLayoutEffect(()=>{
  if(!runtime)return;
  return runtime.register(()=>latest.current);
 },[runtime,options.tripId,options.page]);
 return bridge?.state??{viewId:null,connected:false,error:'应用控制桥未连接'};
}
