export interface AppHost {kind:'browser'|'desktop';reveal():Promise<void>}
declare global {interface Window {travelStoryHost?:{revealWindow?:()=>void|Promise<void>}}}
export function getAppHost():AppHost {
  const desktop=typeof window!=='undefined'&&window.travelStoryHost?.revealWindow;
  return {kind:desktop?'desktop':'browser',async reveal(){
    if(desktop)await desktop();else if(typeof window!=='undefined'){try{window.focus();}catch{/* Browsers may refuse programmatic foreground focus. */}}
  }};
}
