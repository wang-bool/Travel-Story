import { randomUUID } from 'node:crypto';
import { ViewError, type ConnectedView, type ViewRegistry } from './viewRegistry.ts';
export type NavigationTarget = { tripId: string; page: 'plan' | 'play'; viewId?: string; stopId?: string; dayId?: string; revision?: number };
export function chooseAppView(registry: ViewRegistry, target: NavigationTarget): ConnectedView | undefined {
    const views = registry.list();
    if (target.viewId) return views.find(v => v.viewId === target.viewId) ?? (() => { throw new ViewError('VIEW_NOT_CONNECTED'); })();
    for (const candidates of [views.filter(v => v.focused), views.filter(v => v.visibility === 'visible'), views.filter(v => v.tripId === target.tripId && v.page === target.page), views]) {
        if (candidates.length === 1) return candidates[0];
    }
    if (views.length) throw new ViewError('AMBIGUOUS_VIEW');
}
type LaunchReceipt = { commandId: string; tripId: string; page: 'plan' | 'play'; stopId?: string; dayId?: string; revision?: number; status: string; createdAt: number; expiresAt: number; url: string; viewId?: string; error?: string; reused: boolean };
export function createAppNavigator(options: {registry: ViewRegistry; launch: (url: string) => Promise<unknown>; now?: () => number}) {
    const {registry, launch} = options, now = options.now ?? Date.now;
    const launches = new Map<string, LaunchReceipt>();
    let starting: {key: string; receipt: LaunchReceipt; task: Promise<void>} | undefined;
    function getCommand(id: string): Record<string, any> {
        const receipt = launches.get(id);
        if (!receipt) return registry.getCommand(id);
        if (['queued','running'].includes(receipt.status) && now() >= receipt.expiresAt) receipt.status = 'expired';
        if (['queued','running'].includes(receipt.status)) {
            const view = registry.list().find(v => v.launchId === id && v.tripId === receipt.tripId && v.page === receipt.page);
            if (view) {
                receipt.viewId = view.viewId;
                if (view.mapState?.status === 'failed') { receipt.status = 'failed'; receipt.error = String(view.mapState.error || 'Map initialization failed'); }
                else receipt.status = view.ready && (!receipt.revision || Number(view.revision) >= receipt.revision) && (!receipt.stopId || view.selection?.stopId === receipt.stopId) && (!receipt.dayId || view.selection?.dayId === receipt.dayId) ? 'completed' : 'running';
            }
            if (now() >= receipt.expiresAt && !['completed','failed'].includes(receipt.status)) receipt.status = 'expired';
        }
        return {...receipt};
    }
    return {getCommand, async open(target: NavigationTarget, base: string) {
        const url = new URL(`/trip/${encodeURIComponent(target.tripId)}${target.page === 'play' ? '/play' : ''}`, base);
        if (target.stopId) url.searchParams.set('stopId',target.stopId);
        if (target.dayId) url.searchParams.set('dayId',target.dayId);
        if (target.page === 'play') url.searchParams.set('autoplay','0');
        const view = chooseAppView(registry,target);
        if (view) {
            const {viewId: _, ...args} = target;
            const command = registry.enqueue(view.viewId,'navigate',args);
            return {...command,url:url.toString(),reused:true};
        }
        const key = JSON.stringify([base,target]);
        if (starting && !['failed','expired','completed'].includes(String(getCommand(starting.receipt.commandId).status))) {
            if (starting.key !== key) throw new ViewError('APP_STARTING');
            await starting.task;
            return {...starting.receipt};
        }
        const receipt: LaunchReceipt = {...target,commandId:randomUUID(),status:'queued',createdAt:now(),expiresAt:now()+120000,url:'',reused:false};
        url.searchParams.set('openCommandId',receipt.commandId);receipt.url=url.toString();
        launches.set(receipt.commandId,receipt);
        while (launches.size > 200) launches.delete(launches.keys().next().value!);
        const task = Promise.resolve().then(()=>launch(receipt.url)).then(()=>{},()=>{receipt.status='failed';receipt.error='Could not launch the application; open the returned URL manually.';});
        starting = {key,receipt,task};
        await task;
        return {...receipt};
    }};
}
