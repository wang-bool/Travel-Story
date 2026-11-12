export type AppPage = 'home'|'plan'|'play'|'record'|'unknown';
export interface AppRoute {page:AppPage;tripId?:string}
const id = (value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export function appRoute(pathname:string):AppRoute {
  if(pathname==='/')return {page:'home'};
  const match=pathname.match(/^\/trip\/([A-Za-z0-9_-]{1,128})(?:\/(play|record))?\/?$/);
  return match ? {tripId:match[1],page:(match[2]??'plan') as AppPage} : {page:'unknown'};
}
export function navigationTarget(args:Record<string,unknown>){
  if(!id(args.tripId)||!['plan','play'].includes(String(args.page)))throw new Error('无效的应用导航目标');
  for(const key of ['stopId','dayId'])if(args[key]!==undefined&&!id(args[key]))throw new Error('无效的导航选择');
  if(args.revision!==undefined&&(!Number.isInteger(args.revision)||Number(args.revision)<0))throw new Error('无效的行程版本');
  const page=args.page as 'plan'|'play';
  // Selection is applied by the persistent bridge after page readiness, never by a second deep-link actor.
  const href=`/trip/${args.tripId}${page==='play'?'/play?autoplay=0':''}`;
  return {tripId:args.tripId,page,href,revision:args.revision as number|undefined,stopId:args.stopId as string|undefined,dayId:args.dayId as string|undefined};
}
export const sameAppRoute=(a:AppRoute,b:AppRoute)=>a.page===b.page&&a.tripId===b.tripId;
