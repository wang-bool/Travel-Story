import { randomUUID } from 'node:crypto';
export type ViewPage = 'home' | 'plan' | 'play' | 'record' | 'unknown';
export type ViewAction = 'show_day' | 'focus_stop' | 'fit_trip' | 'play' | 'restart' | 'stop' | 'present_change' | 'navigate';
export type CommandStatus = 'queued' | 'running' | 'completed' | 'failed' | 'expired';
export interface ViewState {
    viewId: string;
    tripId?: string;
    launchId?: string;
    appBridge?: boolean;
    host?: 'browser' | 'desktop';
    page: ViewPage;
    ready: boolean;
    revision?: number;
    visibility?: 'visible' | 'hidden';
    focused?: boolean;
    mapState?: Record<string, unknown>;
    selection?: Record<string, unknown>;
    playback?: Record<string, unknown>;
}
export interface ViewCommand {
    commandId: string;
    viewId: string;
    tripId?: string;
    action: ViewAction;
    args: Record<string, unknown>;
    status: CommandStatus;
    createdAt: number;
    expiresAt: number;
    error?: string;
}
export interface ConnectedView extends ViewState {
    lastSeen: number;
}
export class ViewError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
}
const fail = (code: string): never => { throw new ViewError(code); };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const terminal = (status: CommandStatus) => ['completed', 'failed', 'expired'].includes(status);
const copy = <T,>(value: T): T => structuredClone(value);
export function createViewRegistry(options: {
    now?: () => number;
    ttlMs?: number;
    maxViews?: number;
    maxPending?: number;
    maxCommands?: number;
} = {}) {
    const now = options.now ?? Date.now;
    const ttl = options.ttlMs ?? 30000;
    const views = new Map<string, ConnectedView>();
    const commands = new Map<string, ViewCommand>();
    function expireView(id: string) {
        views.delete(id);
        for (const command of commands.values())
            if (command.viewId === id && !terminal(command.status))
                command.status = 'expired';
    }
    function sweep() {
        const time = now();
        for (const view of views.values())
            if (time - view.lastSeen >= ttl)
                expireView(view.viewId);
        for (const command of commands.values())
            if (time >= command.expiresAt && !terminal(command.status))
                command.status = 'expired';
        // Keep recent receipts, but bound memory even if a client never queries them.
        for (const [id, command] of commands)
            if (terminal(command.status) && time - command.expiresAt > 5 * ttl)
                commands.delete(id);
    }
    function target(id: string) {
        sweep();
        return views.get(id) ?? fail('VIEW_NOT_CONNECTED');
    }
    return {
        heartbeat(input: ViewState): ConnectedView {
            sweep();
            if (!input || !identifier(input.viewId) || (input.tripId !== undefined && !identifier(input.tripId)) || !['home', 'plan', 'play', 'record', 'unknown'].includes(input.page) || typeof input.ready !== 'boolean')
                fail('INVALID_ARGUMENT');
            if (['plan', 'play', 'record'].includes(input.page) && !identifier(input.tripId)) fail('INVALID_ARGUMENT');
            if (input.appBridge !== undefined && typeof input.appBridge !== 'boolean') fail('INVALID_ARGUMENT');
            if (input.host !== undefined && !['browser', 'desktop'].includes(input.host)) fail('INVALID_ARGUMENT');
            if (input.launchId !== undefined && !identifier(input.launchId))
                fail('INVALID_ARGUMENT');
            if (input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision < 1))
                fail('INVALID_ARGUMENT');
            if (input.visibility !== undefined && !['visible', 'hidden'].includes(input.visibility))
                fail('INVALID_ARGUMENT');
            if (input.focused !== undefined && typeof input.focused !== 'boolean')
                fail('INVALID_ARGUMENT');
            for (const field of [input.mapState, input.selection, input.playback])
                if (field !== undefined && (!field || typeof field !== 'object' || Array.isArray(field) || JSON.stringify(field).length > 8192))
                    fail('INVALID_ARGUMENT');
            const previous = views.get(input.viewId);
            if (previous && (previous.tripId !== input.tripId || previous.page !== input.page))
                for (const command of commands.values())
                    if (command.viewId === input.viewId && command.action !== 'navigate' && !terminal(command.status)) command.status = 'expired';
            if (!views.has(input.viewId) && views.size >= (options.maxViews ?? 32))
                fail('VIEW_LIMIT');
            const state = copy({ ...input, lastSeen: now() });
            views.set(input.viewId, state);
            return copy(state);
        },
        list(): ConnectedView[] { sweep(); return copy([...views.values()]); },
        enqueue(viewId: string, action: ViewAction | string, args: Record<string, unknown> = {}): ViewCommand {
            const view = target(viewId);
            if (!['show_day', 'focus_stop', 'fit_trip', 'play', 'restart', 'stop', 'present_change', 'navigate'].includes(action))
                fail('INVALID_ACTION');
            if (action !== 'navigate' && !['plan', 'play'].includes(view.page)) fail('INCOMPATIBLE_VIEW');
            if (!view.ready && action !== 'navigate')
                fail('VIEW_NOT_READY');
            if (['play', 'restart', 'stop'].includes(action) && view.page !== 'play')
                fail('INCOMPATIBLE_VIEW');
            if (!args || typeof args !== 'object' || Array.isArray(args))
                fail('INVALID_ARGUMENT');
            if (action === 'present_change' && view.page !== 'plan')
                fail('INCOMPATIBLE_VIEW');
            const required = action === 'show_day' ? 'dayId' : action === 'focus_stop' ? 'stopId' : null;
            if (required && !identifier(args[required]))
                fail('INVALID_ARGUMENT');
            if (action === 'navigate') {
                if (!identifier(args.tripId) || !['plan','play'].includes(String(args.page))) fail('INVALID_ARGUMENT');
                for (const key of ['stopId','dayId']) if (args[key] !== undefined && !identifier(args[key])) fail('INVALID_ARGUMENT');
                if (args.stopId && args.dayId) fail('INVALID_ARGUMENT');
                if (args.revision !== undefined && (!Number.isInteger(args.revision) || Number(args.revision) < 1)) fail('INVALID_ARGUMENT');
                if (Object.keys(args).some(k => !['tripId','page','stopId','dayId','revision'].includes(k))) fail('INVALID_ARGUMENT');
            }
            else if (action === 'present_change') {
                if (!Number.isInteger(args.revision) || Number(args.revision) < 1 || typeof args.message !== 'string' || args.message.length > 500)
                    fail('INVALID_ARGUMENT');
                if (args.fitTrip !== undefined && typeof args.fitTrip !== 'boolean')
                    fail('INVALID_ARGUMENT');
                if (args.stopId !== undefined && !identifier(args.stopId))
                    fail('INVALID_ARGUMENT');
                if (args.dayId !== undefined && !identifier(args.dayId))
                    fail('INVALID_ARGUMENT');
                if (args.addedStopIds !== undefined && (!Array.isArray(args.addedStopIds) || args.addedStopIds.length > 100 || !args.addedStopIds.every(identifier)))
                    fail('INVALID_ARGUMENT');
                if (Object.keys(args).some(k => !['revision', 'message', 'stopId', 'dayId', 'addedStopIds', 'fitTrip'].includes(k)))
                    fail('INVALID_ARGUMENT');
            }
            else if (Object.keys(args).some(key => key !== required))
                fail('INVALID_ARGUMENT');
            if ([...commands.values()].filter(c => c.viewId === viewId && !terminal(c.status)).length >= (options.maxPending ?? 32))
                fail('COMMAND_QUEUE_FULL');
            if (commands.size >= (options.maxCommands ?? 1024)) {
                const receipt = [...commands.values()].find(c => terminal(c.status));
                if (receipt)
                    commands.delete(receipt.commandId);
                else
                    fail('COMMAND_QUEUE_FULL');
            }
            const command: ViewCommand = { commandId: randomUUID(), viewId, tripId: action === 'navigate' ? String(args.tripId) : view.tripId, action: action as ViewAction, args: copy(args), status: 'queued', createdAt: now(), expiresAt: now() + (action === 'navigate' ? 120000 : ttl) };
            commands.set(command.commandId, command);
            return copy(command);
        },
        getCommand(id: string): ViewCommand { sweep(); return copy(commands.get(id) ?? fail('COMMAND_NOT_FOUND')); },
        pending(viewId: string): ViewCommand[] { target(viewId); return copy([...commands.values()].filter(c => c.viewId === viewId && c.status === 'queued')); },
        acknowledge(viewId: string, commandId: string, status: 'running' | 'completed' | 'failed', error?: string): ViewCommand {
            target(viewId);
            const command = commands.get(commandId) ?? fail('COMMAND_NOT_FOUND');
            if (command.viewId !== viewId)
                fail('COMMAND_TARGET_MISMATCH');
            if (!['running', 'completed', 'failed'].includes(status) || terminal(command.status) || (status === 'completed' && command.status !== 'running'))
                fail('INVALID_COMMAND_STATE');
            command.status = status;
            if (status === 'failed')
                command.error = String(error ?? 'Page command failed').slice(0, 1000);
            return copy(command);
        },
        remove(viewId: string) { sweep(); expireView(viewId); },
    };
}
export type ViewRegistry = ReturnType<typeof createViewRegistry>;
const globalRegistry = globalThis as typeof globalThis & {
    __travelStoryViews?: ViewRegistry;
};
export function getViewRegistry(): ViewRegistry { return globalRegistry.__travelStoryViews ??= createViewRegistry(); }
