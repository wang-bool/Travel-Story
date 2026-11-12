import {navigationTarget, sameAppRoute, type AppRoute} from './appNavigation.ts';
import {waitForPresentationRevision, nextPresentationFrame} from './agentPresentation.ts';
import type {ViewCommand} from './server/viewRegistry.ts';
export interface AgentPageRegistration {
 tripId:string;page:string;ready:boolean;selection?:Record<string,unknown>;playback?:Record<string,unknown>;mapState?:Record<string,unknown>;
 getMapState?:()=>Record<string,unknown>|undefined;
 onCommand:(command:ViewCommand)=>void|Promise<void>;
}
export interface RuntimeCommand {commandId:string;tripId:string;action:string;args:Record<string,unknown>;expiresAt:number}
interface Dependencies {
 route:()=>AppRoute;navigate:(target:ReturnType<typeof navigationTarget>)=>Promise<void>|void;
 refresh:()=>Promise<void>;read:(id:string)=>{revision?:number}|null;
 reveal?:()=>Promise<void>;commit?:()=>Promise<void>;sleep?:()=>Promise<void>;now?:()=>number;
}
export function createAppAgentRuntime(deps:Dependencies){
 let registration:{token:symbol;get:()=>AgentPageRegistration}|null=null;
 let disposed=false;
 let epoch=0;
 const now=deps.now??Date.now;
 const sleep=deps.sleep??(()=>new Promise<void>(r=>setTimeout(r,50)));
 const commit=deps.commit??nextPresentationFrame;
 const compatible=()=>{
  if(!registration)return null;
  const page=registration.get();
  return sameAppRoute(deps.route(),page as AppRoute)?{...registration,page}:null;
 };
 const alive=(command:RuntimeCommand)=>{if(disposed||now()>=command.expiresAt)throw new Error('应用命令已取消或过期');};
 const runtime={
  register(input:AgentPageRegistration|(()=>AgentPageRegistration)){
   const token=Symbol('page');registration={token,get:typeof input==='function'?input:()=>input};
   return ()=>{if(registration?.token===token)registration=null;};
  },
  view(){const entry=compatible();const route=deps.route();if(!entry)return {...route,ready:route.page==='home'||route.page==='record'};
   const {onCommand:_handler,getMapState,...page}=entry.page;
   return {...page,...route,mapState:getMapState?.()??page.mapState};
  },
  dispose(){disposed=true;epoch++;},
  resume(){disposed=false;},
  async execute(command:RuntimeCommand){
   const executionEpoch=epoch;
   const valid=()=>{alive(command);if(executionEpoch!==epoch)throw new Error('应用窗口已重新连接');};
   valid();
   if(command.action==='navigate'){
    const target=navigationTarget(command.args);
    if(command.tripId!==target.tripId)throw new Error('导航行程不匹配');
    const source=deps.route();let arrived=sameAppRoute(source,target);
    const check=()=>{valid();const route=deps.route();
      if(sameAppRoute(route,target)){arrived=true;return;}
      if(arrived||!sameAppRoute(route,source))throw new Error('页面已切换，导航已取消');
    };
    await deps.reveal?.();check();
    await waitForPresentationRevision(target.revision??0,{read:()=>deps.read(target.tripId),refresh:deps.refresh,commit,cancelled:()=>{check();return false;}});
    check();await deps.navigate(target);
    while(true){check();const entry=compatible();
      if(entry&&sameAppRoute(entry.page as AppRoute,target)){
       if(entry.page.mapState?.status==='failed'||entry.page.getMapState?.()?.status==='failed')throw new Error(String(entry.page.getMapState?.()?.error??entry.page.mapState?.error??'地图加载失败'));
       if(entry.page.ready){
        await commit();await commit();check();const fresh=compatible();
        if(!fresh||fresh.token!==entry.token||!fresh.page.ready){await sleep();continue;}
        if(target.stopId||target.dayId){
         const selection={...command,action:target.stopId?'focus_stop':'show_day',args:target.stopId?{stopId:target.stopId}:{dayId:target.dayId}};
         await fresh.page.onCommand(selection as unknown as ViewCommand);check();
         if(compatible()?.token!==fresh.token)throw new Error('页面已切换，导航已取消');
        }
        valid();return;
       }
      }
      await sleep();
    }
   }
   const initial=compatible();
   if(!initial||!initial.page.ready||initial.page.tripId!==command.tripId)throw new Error('页面尚未就绪或已切换');
   const checkPage=()=>{valid();if(compatible()?.token!==initial.token||!sameAppRoute(deps.route(),initial.page as AppRoute))throw new Error('页面已切换，展示已取消');};
   await deps.reveal?.();checkPage();
   if(command.action==='present_change')await waitForPresentationRevision(Number(command.args.revision),{
    read:()=>deps.read(command.tripId),refresh:deps.refresh,commit,cancelled:()=>{checkPage();return false;},
   });
   checkPage();const fresh=compatible()!;
   await fresh.page.onCommand(command as ViewCommand);checkPage();
  },
 };
 return runtime;
}
export type AppAgentRuntime=ReturnType<typeof createAppAgentRuntime>;
