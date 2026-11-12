interface RevisionBarrier {
  read: () => {revision?: number} | null;
  refresh: () => Promise<void>;
  commit?: () => Promise<void>;
  sleep?: () => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  cancelled?: () => boolean;
}
// A background tab may throttle RAF completely. The timeout also allows command failure
// handling and polling to make progress while browser focus is being restored.
export function nextPresentationFrame(): Promise<void> {
  return new Promise(resolve => {
    let frame = 0;
    const finish = () => {clearTimeout(timer);if(frame)cancelAnimationFrame(frame);resolve();};
    const timer = setTimeout(finish,120);
    frame = requestAnimationFrame(finish);
  });
}
export async function waitForPresentationRevision(revision: number, options: RevisionBarrier): Promise<void> {
  if (!Number.isInteger(revision) || revision < 0) throw new Error('无效的行程版本');
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 15_000);
  const checkCancelled = () => {if(options.cancelled?.())throw new Error('页面展示已取消');};
  do {
    checkCancelled();
    await options.refresh();
    checkCancelled();
    if ((options.read()?.revision ?? -1) >= revision) {
      const commit = options.commit ?? nextPresentationFrame;
      await commit();await commit();
      checkCancelled();
      return;
    }
    if(now()>=deadline)break;
    await (options.sleep?.() ?? new Promise(resolve=>setTimeout(resolve,100)));
  } while(now()<=deadline);
  throw new Error('未能同步到最新行程，地图展示未完成');
}

/** An explicit target represents the final operation in a mixed edit batch. */
export function resolvePresentationTarget(args: Record<string, unknown>, snapshot?: {stops:{id:string}[];days:{id:string}[]}): {stopId?:string;dayId?:string} {
  const stopId = typeof args.stopId === 'string' ? args.stopId : undefined;
  const dayId = typeof args.dayId === 'string' ? args.dayId : undefined;
  const addedIds = Array.isArray(args.addedStopIds) ? args.addedStopIds.filter((id):id is string=>typeof id==='string') : [];
  const target=stopId || dayId ? {...(stopId ? {stopId} : {}),...(dayId ? {dayId} : {})} : addedIds.length ? {stopId:addedIds.at(-1)!} : {};
  if(snapshot && target.stopId && !snapshot.stops.some(s=>s.id===target.stopId))throw new Error('目标地点已不存在，行程可能已被后续操作更新');
  if(snapshot && target.dayId && !snapshot.days.some(d=>d.id===target.dayId))throw new Error('目标日期已不存在，行程可能已被后续操作更新');
  return target;
}
