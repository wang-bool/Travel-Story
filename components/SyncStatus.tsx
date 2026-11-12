'use client';
import { useSyncExternalStore } from 'react';
import { getSyncStatus, subscribeStatus, importLegacy, downloadLegacyBackup } from '@/lib/store';
const serverState={saving:0,error:'',connected:false,legacyAvailable:false,legacyPreserved:false};
export function SyncStatus(){
  const state=useSyncExternalStore(subscribeStatus,getSyncStatus,()=>serverState);
  if(!state.error&&!state.saving&&!state.legacyAvailable&&!state.legacyPreserved)return null;
  return <aside role={state.error?'alert':'status'} style={{position:'fixed',bottom:16,left:16,zIndex:10000,maxWidth:'min(460px, calc(100vw - 32px))',padding:'12px 16px',background:'#fff8eb',color:'#322d27',border:'1px solid #d8cbb5',borderRadius:8,boxShadow:'0 2px 12px #0002'}}>
    {state.error|| (state.saving?'正在保存…':state.legacyAvailable?'发现仅保存在此浏览器的旧行程。':'此浏览器的旧行程已保留备份，未自动合并。')}
    {state.legacyPreserved&&!state.legacyAvailable&&<button className="btn btn-sm" onClick={downloadLegacyBackup}>导出旧行程备份</button>}
    {state.legacyAvailable&&<button className="btn btn-sm" onClick={()=>{void importLegacy().catch(()=>{});}}>导入旧行程</button>}
  </aside>;
}
