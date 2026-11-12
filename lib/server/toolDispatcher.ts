import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateTool } from '../../mcp/tools.mjs';
import { check, TravelError } from '../domain/itinerary.ts';
import { getTravelService, type TravelService } from './travelService.ts';
import { getViewRegistry, type ViewRegistry } from './viewRegistry.ts';
import { createAppNavigator } from './appNavigator.ts';
import { createMutationPresenter } from './mutationPresentation.ts';
import { getSearchStatus, searchForAgent, resolveCandidate, markCandidateAdopted } from './placeSearch.ts';
import { getForecast, type WeatherInput } from './weather.ts';
import {chooseAppView} from './appNavigator.ts';
import {createPlanTaskRunner} from './planTasks.ts';
const exec = promisify(execFile);
async function openBrowser(url: string) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    await exec(command, [url], { timeout: 10000 });
}
export function createToolDispatcher(options: {
    service?: TravelService;
    registry?: ViewRegistry;
    open?: (url: string) => Promise<unknown>;
} = {}) {
    const service = options.service ?? getTravelService(), registry = options.registry ?? getViewRegistry(), open = options.open ?? openBrowser;
    const navigator = createAppNavigator({registry, launch:open});
    const presenter = createMutationPresenter({ registry });
    const requireReadyView = (viewId:string) => {
        const view=registry.list().find(v=>v.viewId===viewId);
        check(view,'VIEW_NOT_CONNECTED','Target page is not connected');
        check(view.ready && view.mapState?.status!=='failed','VIEW_NOT_READY','Target page is not ready');
    };
    async function waitCommand(receipt:Record<string,any>) {
        let current=receipt;
        while(true){
            if(current.status==='completed')return current;
            check(!['failed','expired'].includes(current.status),'VIEW_FAILED',String(current.error||'Page did not acknowledge the command'));
            check(Date.now()<Number(current.expiresAt),'VIEW_FAILED','Page command expired');
            await new Promise(resolve=>setTimeout(resolve,150));current=navigator.getCommand(current.commandId);
        }
    }
    async function waitReadyView(viewId:string,tripId:string,page:'plan'|'play') {
        const deadline=Date.now()+30000;
        while(Date.now()<deadline){
            const view=registry.list().find(v=>v.viewId===viewId);
            check(view,'VIEW_NOT_CONNECTED','Target page disconnected');
            check(view.mapState?.status!=='failed','VIEW_FAILED','Target map failed');
            if(view.tripId===tripId&&view.page===page&&view.ready)return;
            await new Promise(resolve=>setTimeout(resolve,150));
        }
        throw new TravelError('VIEW_NOT_READY','Target page did not publish readiness');
    }
    const planTasks=createPlanTaskRunner({directory:service.directory,service,assertView:requireReadyView,resolveCandidate,adopted:markCandidateAdopted,
        present:async(name,result,viewId,requestId,base)=>{
            const shown=await presenter.present(name,{requestId,presentation:{viewId}},result,async()=>dispatch('open_trip',{tripId:result.tripId,page:'plan',viewId},base) as Promise<any>);
            if(shown.status==='pending'&&shown.commandId){await waitCommand(navigator.getCommand(shown.commandId));await waitReadyView(viewId,result.tripId,'plan');return;}
            check(shown.status==='completed',shown.code||'VIEW_FAILED',shown.error||'Page did not present saved changes');
            await waitReadyView(viewId,result.tripId,'plan');
        },
        finish:async(job)=>{
            requireReadyView(job.viewId);
            const page=job.finish==='play'&&job.stops.length>1?'play':'plan';
            await waitCommand(await dispatch('open_trip',{tripId:job.tripId,page,viewId:job.viewId},job.base));
            await waitReadyView(job.viewId,job.tripId,page);
            if(page==='play')await waitCommand(await dispatch('control_view',{viewId:job.viewId,action:'play'},job.base));
        },
    });
    async function dispatch(name: string, args: Record<string, any>, base = 'http://localhost:3000'): Promise<Record<string, any>> {
        const origin = new URL(base);
        check(['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && origin.protocol === 'http:' && !origin.username && !origin.password, 'INVALID_INPUT', 'Application URL must be local HTTP');
        const input = validateTool(name, args) as Record<string, any>;
        const urlFor = (tripId: string, page = 'plan') => new URL(`/trip/${encodeURIComponent(tripId)}${page === 'play' ? '/play' : ''}`, origin).toString();
        if (name === 'ensure_service') return {status:'running',url:origin.origin,launched:false};
        if (name === 'get_status')
            return { version: '0.3.0', search: getSearchStatus(), connectedViews: registry.list().length, url:origin.origin,views:registry.list(),capabilities: { planReview:true, planTasks:true, searchActivity:true, manualEditing: true, mcp: true, visibleEdits: true, singleWindow: true, pages: ['plan', 'play'], playback: ['play', 'restart', 'stop'], videoExportViaMcp: false, weather: 'open-meteo' } };
        if (name === 'get_weather') return getForecast(input as unknown as WeatherInput);
        if(name==='apply_plan')return planTasks.apply(input,origin.origin);
        if(name==='get_plan_task')return planTasks.get(input.taskId,input.waitMs??15000);
        if (name === 'search_places') {
            const view=registry.list().length || input.viewId ? chooseAppView(registry,{tripId:'',page:'plan',viewId:input.viewId}) : undefined;
            const {viewId:_viewId,...query}=input;
            return searchForAgent(query as Parameters<typeof searchForAgent>[0],{viewId:view?.viewId});
        }
        if (name === 'get_view_state') {
            const views = registry.list().filter(v => !input.viewId || v.viewId === input.viewId);
            if (input.viewId)
                check(views.length, 'VIEW_NOT_CONNECTED', 'Requested page is not connected');
            return { views };
        }
        if (name === 'get_command') return navigator.getCommand(input.commandId);
        if (name === 'control_view') {
            const view = registry.list().find(v => v.viewId === input.viewId);
            check(view, 'VIEW_NOT_CONNECTED', 'Page is not connected');
            const { trip } = await service.execute('get_trip', { tripId: view.tripId });
            const args: Record<string, unknown> = {};
            if (input.action === 'show_day') {
                check(trip.days.some((d: {
                    id: string;
                }) => d.id === input.dayId), 'DAY_NOT_FOUND', 'Day not found');
                args.dayId = input.dayId;
            }
            if (input.action === 'focus_stop') {
                check(trip.stops.some((s: {
                    id: string;
                }) => s.id === input.stopId), 'STOP_NOT_FOUND', 'Stop not found');
                args.stopId = input.stopId;
            }
            check(!input.dayId || input.action === 'show_day', 'INVALID_INPUT', 'dayId is only accepted for show_day');
            check(!input.stopId || input.action === 'focus_stop', 'INVALID_INPUT', 'stopId is only accepted for focus_stop');
            return registry.enqueue(input.viewId, input.action, args) as unknown as Record<string, unknown>;
        }
        if (name === 'open_trip') {
            const { trip } = await service.execute('get_trip', { tripId: input.tripId });
            if (input.dayId)
                check(trip.days.some((d: {
                    id: string;
                }) => d.id === input.dayId), 'DAY_NOT_FOUND', 'Day not found');
            if (input.stopId)
                check(trip.stops.some((s: {
                    id: string;
                }) => s.id === input.stopId), 'STOP_NOT_FOUND', 'Stop not found');
            check(!(input.dayId && input.stopId), 'INVALID_INPUT', 'Choose dayId or stopId');
            return navigator.open({tripId:input.tripId,page:input.page ?? 'plan',...(input.viewId ? {viewId:input.viewId} : {}),...(input.stopId ? {stopId:input.stopId} : {}),...(input.dayId ? {dayId:input.dayId} : {})}, base);
        }
        const { presentation: _presentation, ...dataInput } = input;
        const result = await service.execute(name, dataInput);
        if (['create_trip', 'update_trip', 'edit_itinerary', 'calculate_routes'].includes(name)) {
            result.presentation = await presenter.present(name, input, result, async () => dispatch('open_trip', { tripId: result.tripId, page: 'plan', ...(input.presentation?.viewId ? {viewId:input.presentation.viewId} : {}) }, base) as Promise<{
                commandId: string;
                viewId?: string;
                status: string;
                url?: string;
                error?: string;
            }>);
        }
        if(name==='edit_itinerary')for(const op of input.operations){if(op.candidateId)markCandidateAdopted(op.candidateId,input.presentation?.viewId??result.presentation?.viewId);}
        if (name === 'delete_trip')
            result.presentation = { status: 'skipped' };
        if (result.trip) {
            result.trip = { ...result.trip, segments: result.trip.segments.map(({ route, ...segment }: Record<string, unknown>) => ({ ...segment, hasGeometry: !!route })) };
            result.url = urlFor(result.tripId);
        }
        if (name === 'list_trips')
            result.trips = result.trips.map((t: Record<string, any>) => ({ ...t, url: urlFor(t.id) }));
        return result;
    }
    return dispatch;
}
const root = globalThis as typeof globalThis & {
    __travelDispatcher?: ReturnType<typeof createToolDispatcher>;
};
export const getToolDispatcher = () => root.__travelDispatcher ??= createToolDispatcher();
