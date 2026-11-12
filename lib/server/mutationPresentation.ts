import { chooseAppView } from './appNavigator.ts';
import type { ViewRegistry, ConnectedView } from './viewRegistry.ts';
export interface PresentationResult {
    status: 'completed' | 'pending' | 'failed' | 'skipped';
    commandId?: string;
    openCommandId?: string;
    viewId?: string;
    url?: string;
    code?: string;
    error?: string;
}
type MutationResult = Record<string, any>;
type OpenResult = {
    commandId: string;
    viewId?: string;
    status: string;
    url?: string;
    error?: string;
};
export function describeMutation(name: string, result: MutationResult) {
    const args: Record<string, unknown> = { revision: result.revision, message: 'Agent 已更新行程', fitTrip: name !== 'update_trip' };
    if (name === 'create_trip')
        args.message = `Agent 已创建行程：${result.trip.name}`;
    if (name === 'update_trip')
        args.message = `Agent 已更新：${result.trip.name}`;
    if (name === 'calculate_routes')
        args.message = result.routes?.some((r: any) => r.quality === 'unavailable') ? 'Agent 已计算路线，部分交通方式暂无可用路线' : 'Agent 已更新路线';
    if (name === 'edit_itinerary') {
        const results = result.results ?? [], stops = result.trip?.stops ?? [], days = result.trip?.days ?? [];
        const target = [...results].reverse().find(r => (r.stopId && stops.some((s: any) => s.id === r.stopId)) || (r.dayId && days.some((d: any) => d.id === r.dayId)));
        const selected = target?.stopId && stops.some((s: any) => s.id === target.stopId) ? target : undefined;
        if (selected)
            args.stopId = selected.stopId;
        else if (target?.dayId)
            args.dayId = target.dayId;
        args.addedStopIds = results.filter((r: any) => r.op === 'add_stop' && stops.some((s: any) => s.id === r.stopId)).map((r: any) => r.stopId);
        const last = results.at(-1), stop = stops.find((s: any) => s.id === selected?.stopId);
        const labels: Record<string, string> = { add_stop: '添加', update_stop: '更新', move_stop: '移动', remove_stop: '删除地点', add_day: '添加一天', remove_day: '删除一天', set_transport: '调整交通方式' };
        args.message = results.length === 1 ? `Agent 已${labels[last?.op] ?? '更新行程'}${stop ? `：${stop.name}` : ''}` : `Agent 已更新行程（${results.length} 项操作）`;
    }
    args.message = String(args.message).slice(0, 500);
    return args;
}
export function createMutationPresenter(options: {
    registry: ViewRegistry;
    waitMs?: number;
    ackWaitMs?: number;
    pollMs?: number;
}) {
    const { registry } = options, waitMs = options.waitMs ?? 30000, ackWaitMs = options.ackWaitMs ?? 10000, pollMs = options.pollMs ?? 150;
    const sleep = () => new Promise<void>(resolve => setTimeout(resolve, pollMs));
    const receipts = new Map<string, Promise<PresentationResult>>();
    const openings = new Map<string, Promise<ConnectedView>>();
    async function ready(view: ConnectedView, deadline = Date.now() + waitMs) {
        while (Date.now() < deadline) {
            const current = registry.list().find(v => v.viewId === view.viewId && v.tripId === view.tripId && v.page === 'plan');
            if (!current)
                throw Object.assign(new Error('行程页面已断开'), { code: 'VIEW_NOT_CONNECTED' });
            if (current.mapState?.status === 'failed')
                throw Object.assign(new Error(String(current.mapState.error || '地图加载失败')), { code: 'VIEW_FAILED' });
            if (current.ready)
                return current;
            await sleep();
        }
        throw Object.assign(new Error('行程已保存，但地图尚未就绪；请打开页面后重试展示'), { code: 'VIEW_NOT_READY' });
    }
    async function ensureView(tripId: string, viewId: string | undefined, open: () => Promise<OpenResult>) {
        const existing = chooseAppView(registry,{tripId,page:'plan',viewId});
        if (existing?.tripId === tripId && existing.page === 'plan')
            return ready(existing);
        const key = `${viewId ?? existing?.viewId ?? 'launch'}:${tripId}`;
        if (!openings.has(key)) {
            const pending = (async () => {
                const receipt = await open();
                if (receipt.status === 'failed')
                    throw Object.assign(new Error(receipt.error || '浏览器无法打开'), { code: 'BROWSER_OPEN_FAILED', openCommandId: receipt.commandId, url: receipt.url });
                const deadline = Date.now() + waitMs;
                while (Date.now() < deadline) {
                    const view = registry.list().find(v => v.tripId === tripId && v.page === 'plan' && (receipt.viewId ? v.viewId === receipt.viewId : v.launchId === receipt.commandId));
                    if (receipt.viewId) {
                        const navigation = registry.getCommand(receipt.commandId);
                        if (['failed','expired'].includes(navigation.status)) throw Object.assign(new Error(navigation.error || 'Navigation failed'),{code:'NAVIGATION_FAILED'});
                        if (navigation.status !== 'completed') { await sleep(); continue; }
                    }
                    if (view) return ready(view, deadline);
                    await sleep();
                }
                throw Object.assign(new Error('行程已保存，但未收到浏览器页面连接，请手动打开返回地址'), { code: 'VIEW_NOT_CONNECTED', openCommandId: receipt.commandId, url: receipt.url });
            })();
            openings.set(key, pending);
            pending.finally(() => openings.delete(key)).catch(() => { });
        }
        return openings.get(key)!;
    }
    async function deliver(name: string, input: Record<string, any>, result: MutationResult, open: () => Promise<OpenResult>): Promise<PresentationResult> {
        try {
            const view = await ensureView(result.tripId, input.presentation?.viewId, open);
            const command = registry.enqueue(view.viewId, 'present_change', describeMutation(name, result));
            const deadline = Date.now() + ackWaitMs;
            while (Date.now() < deadline) {
                const receipt = registry.getCommand(command.commandId);
                if (receipt.status === 'completed')
                    return { status: 'completed', commandId: command.commandId, viewId: view.viewId };
                if (receipt.status === 'failed' || receipt.status === 'expired')
                    return { status: 'failed', commandId: command.commandId, viewId: view.viewId, code: receipt.status === 'expired' ? 'COMMAND_EXPIRED' : 'VIEW_FAILED', error: receipt.error || '页面未及时完成展示' };
                await sleep();
            }
            return { status: 'pending', commandId: command.commandId, viewId: view.viewId };
        }
        catch (e) {
            const error = e as {
                code?: string;
                message?: string;
                openCommandId?: string;
                url?: string;
            };
            return { status: 'failed', code: error.code ?? 'PRESENTATION_FAILED', error: error.message ?? '页面展示失败；行程已保存', ...(error.openCommandId ? { openCommandId: error.openCommandId } : {}), ...(error.url ? { url: error.url } : {}) };
        }
    }
    return { present(name: string, input: Record<string, any>, result: MutationResult, open: () => Promise<OpenResult>): Promise<PresentationResult> {
            if (input.presentation?.mode === 'none')
                return Promise.resolve({ status: 'skipped' });
            const key = JSON.stringify([name, input.requestId, result.tripId, result.revision, input.presentation ?? {}]);
            if (!receipts.has(key)) {
                const task = deliver(name, input, result, open);
                receipts.set(key, task);
                if (receipts.size > 1000)
                    receipts.delete(receipts.keys().next().value!);
            }
            return receipts.get(key)!;
        } };
}
