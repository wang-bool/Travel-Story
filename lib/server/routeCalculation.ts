import { gcj02ToWgs84, wgs84ToGcj02, outOfChina } from '../coord.ts';
import type { TripStop, Transport, RouteGeometry } from '../types.ts';

export interface SegmentRouteResult {
  route: RouteGeometry | null;
  distance?: number;
  duration?: number;
  requestedTransport: Transport;
  actualProfile: string | null;
  provider: string | null;
  geometryKind: 'road' | 'great_circle' | 'straight_line' | 'none';
  quality: 'routed' | 'schematic' | 'unavailable';
  warnings: string[];
}
type Point = Pick<TripStop, 'latitude' | 'longitude'>;
function valid(p: Point) { return Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180; }
function unavailable(transport: Transport, warning: string): SegmentRouteResult {
  return { route: null, requestedTransport: transport, actualProfile: null, provider: null, geometryKind: 'none', quality: 'unavailable', warnings: [warning] };
}
function distance(from: Point, to: Point) {
  const rad = Math.PI / 180;
  const a = Math.sin((to.latitude-from.latitude)*rad/2)**2 + Math.cos(from.latitude*rad)*Math.cos(to.latitude*rad)*Math.sin((to.longitude-from.longitude)*rad/2)**2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1,a)));
}
function greatCircle(from: Point, to: Point): [number, number][] {
  const rad = Math.PI/180;
  const vector=(p:Point)=>[Math.cos(p.latitude*rad)*Math.cos(p.longitude*rad),Math.cos(p.latitude*rad)*Math.sin(p.longitude*rad),Math.sin(p.latitude*rad)];
  const a=vector(from),b=vector(to); const omega=Math.acos(Math.max(-1,Math.min(1,a.reduce((sum,x,i)=>sum+x*b[i],0))));
  // Antipodal endpoints have no unique great circle. Avoid an invalid interpolation.
  if (Math.abs(Math.sin(omega))<1e-8) return [[from.longitude,from.latitude],[to.longitude,to.latitude]];
  return Array.from({length:65},(_,i)=>{const t=i/64;const p=a.map((x,j)=>(Math.sin((1-t)*omega)*x+Math.sin(t*omega)*b[j])/Math.sin(omega));return [Math.atan2(p[1],p[0])/rad,Math.atan2(p[2],Math.hypot(p[0],p[1]))/rad];});
}
function numericMetric(value: unknown): number | undefined {
  if (!(typeof value === 'number' || (typeof value === 'string' && value.trim().length > 0))) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}
function parsePolyline(polyline: string): [number, number][] {
  return polyline.split(';').flatMap(pair=>{const tokens=pair.split(',');if(tokens.length!==2||tokens.some(t=>!t.trim()))return [];const [lon,lat]=tokens.map(Number);if(!valid({latitude:lat,longitude:lon}))return [];const p=gcj02ToWgs84(lat,lon);return [[p.lon,p.lat] as [number,number]];});
}
export async function calculateSegmentRoute(from: Point, to: Point, transport: Transport): Promise<SegmentRouteResult> {
  if (!valid(from)||!valid(to)) throw Object.assign(new Error('Invalid route coordinates'),{code:'INVALID_ARGUMENT'});
  if (['plane','ufo','rocket','ship','kayak','swim'].includes(transport)) {
    const air=['plane','ufo','rocket'].includes(transport);
    return {route:{type:'LineString',coordinates:air?greatCircle(from,to):[[from.longitude,from.latitude],[to.longitude,to.latitude]]}, distance:distance(from,to),requestedTransport:transport,actualProfile:null,provider:'geodesic',geometryKind:air?'great_circle':'straight_line',quality:'schematic',warnings:['Illustrative connection only; distance is geodesic, not a navigable route. No schedule or travel-time estimate.']};
  }
  const profile = transport==='walk'?'walking':transport==='bicycle'?'cycling':transport==='car'?'driving':null;
  if (!profile) return unavailable(transport,'No transport-specific route provider configured; driving estimates will not be substituted.');
  if (profile!=='driving' && (outOfChina(from.latitude,from.longitude)||outOfChina(to.latitude,to.longitude))) return unavailable(transport,'Walking/cycling provider supports domestic China only.');
  if (profile!=='driving' && !process.env.GAODE_KEY?.trim()) return unavailable(transport,'GAODE_KEY is not configured for walking/cycling routes.');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try {
    let route:RouteGeometry;let meters:unknown;let seconds:unknown;let provider:string;
    if(profile==='driving') {
      provider='osrm';const res=await fetch(`https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`,{signal:controller.signal});
      if(!res.ok)throw new Error('OSRM request failed');const json=await res.json();
      if(json.code!=='Ok'||!json.routes?.length)throw new Error('No route');
      const r=json.routes[0];route={type:'LineString',coordinates:r.geometry?.coordinates};meters=r.distance;seconds=r.duration;
    } else {
      provider='gaode';const a=wgs84ToGcj02(from.latitude,from.longitude),b=wgs84ToGcj02(to.latitude,to.longitude);
      const url=new URL(profile==='walking'?'https://restapi.amap.com/v3/direction/walking':'https://restapi.amap.com/v4/direction/bicycling');
      url.searchParams.set('key',process.env.GAODE_KEY!.trim());url.searchParams.set('origin',`${a.lon},${a.lat}`);url.searchParams.set('destination',`${b.lon},${b.lat}`);
      const res=await fetch(url,{signal:controller.signal});if(!res.ok)throw new Error('Gaode request failed');const json=await res.json();
      if(profile==='walking'?json.status!=='1':json.errcode!==0)throw new Error('Gaode route failed');
      const p=(profile==='walking'?json.route?.paths:json.data?.paths)?.[0];if(!p)throw new Error('No route');
      route={type:'LineString',coordinates:(p.steps??[]).flatMap((s:{polyline?:string})=>s.polyline?parsePolyline(s.polyline):[])};meters=numericMetric(p.distance);seconds=numericMetric(p.duration);
    }
    if(!Array.isArray(route.coordinates)||route.coordinates.length<2||!route.coordinates.every(p=>Array.isArray(p)&&p.length>=2&&valid({latitude:p[1],longitude:p[0]}))||typeof meters!=='number'||!Number.isFinite(meters)||meters<0||typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid route result');
    return {route,distance:meters,duration:seconds,requestedTransport:transport,actualProfile:profile,provider,geometryKind:'road',quality:'routed',warnings:[]};
  } catch {return unavailable(transport,'Route provider failed or returned no valid route; no substituted duration.');}
  finally {clearTimeout(timer);}
}
