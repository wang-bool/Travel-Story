import { randomUUID } from 'node:crypto';
import type { DetailedCandidate, DetailedSearchResult } from '../geocode.ts';

export interface AgentActivity {
 id: string;
 viewId: string;
 kind: 'search' | 'plan';
 title: string;
 status: 'running' | 'completed' | 'failed';
 startedAt: number;
 updatedAt: number;
 durationMs?: number;
 query?: Record<string, unknown>;
 candidates?: (DetailedCandidate & {candidateId: string})[];
 selectedCandidateIds?: string[];
 providerStatus?: DetailedSearchResult['providerStatus'];
 cached?: boolean;
 error?: string;
 message?: string;
 step?: {index: number; total: number; label: string};
}
type ActivityInput = Pick<AgentActivity, 'viewId' | 'kind' | 'title' | 'query' | 'step'>;
type ActivityPatch = Partial<Omit<AgentActivity, 'id' | 'viewId' | 'startedAt' | 'updatedAt'>>;
export const validActivityViewId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export function createAgentActivityStore() {
 const views = new Map<string, AgentActivity[]>();
 const listeners = new Map<string, Set<() => void>>();
 const emit = (viewId: string) => { for (const callback of listeners.get(viewId) ?? []) { try { callback(); } catch { /* A disconnected observer cannot fail a search. */ } } };
 return {
  start(input: ActivityInput): string {
   if (!validActivityViewId(input.viewId)) throw new Error('Invalid activity view');
   // Bound abandoned window history as well as each individual window.
   if (!views.has(input.viewId) && views.size >= 64) {
    const oldest = [...views.keys()].find(key => !listeners.get(key)?.size);
    if (oldest) views.delete(oldest);
   }
   const now = Date.now();
   const record: AgentActivity = {...structuredClone(input), id: randomUUID(), status: 'running', startedAt: now, updatedAt: now};
   views.set(input.viewId, [...(views.get(input.viewId) ?? []), record].slice(-30));
   emit(input.viewId); return record.id;
  },
  update(id: string, patch: ActivityPatch) {
   for (const [viewId, records] of views) {
    const record = records.find(item => item.id === id);
    if (!record) continue;
    const durationMs = record.durationMs ?? (patch.status && patch.status !== 'running' ? Math.max(0, Date.now() - record.startedAt) : undefined);
    Object.assign(record, structuredClone(patch), {id: record.id, viewId: record.viewId, startedAt: record.startedAt, updatedAt: Date.now()});
    if (durationMs !== undefined) record.durationMs = durationMs;
    emit(viewId); return;
   }
  },
  list(viewId: string): AgentActivity[] { return structuredClone(views.get(viewId) ?? []); },
  subscribe(viewId: string, listener: () => void) {
   if (!validActivityViewId(viewId)) throw new Error('Invalid activity view');
   const set = listeners.get(viewId) ?? new Set<() => void>();set.add(listener);listeners.set(viewId,set);
   return () => {set.delete(listener);if (!set.size) listeners.delete(viewId);};
  },
 };
}
export type AgentActivityStore = ReturnType<typeof createAgentActivityStore>;
const root = globalThis as typeof globalThis & {__travelAgentActivity?: AgentActivityStore};
export function getAgentActivityStore(): AgentActivityStore {return root.__travelAgentActivity ??= createAgentActivityStore();}
