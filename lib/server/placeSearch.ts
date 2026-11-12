import { randomUUID } from 'node:crypto';
import { searchPlacesDetailed, type PlaceSearchInput, type DetailedCandidate } from '../geocode.ts';
import { getAgentActivityStore } from './agentActivity.ts';

interface RegisteredCandidate { candidate: DetailedCandidate; expiresAt: number }
const root = globalThis as typeof globalThis & { __travelCandidates?: Map<string, RegisteredCandidate> };
const registry = root.__travelCandidates ??= new Map<string, RegisteredCandidate>();
export function getSearchStatus() {
  const providers = { gaode: Boolean(process.env.GAODE_KEY?.trim()), locationiq: Boolean(process.env.LOCATIONIQ_KEY?.trim()) };
  return { configured: Object.values(providers).some(Boolean), providers };
}
export async function searchForAgent(input: PlaceSearchInput, options: {viewId?: string} = {}) {
  // Explicit projection prevents presentation metadata entering provider requests/cache keys.
  const providerInput: PlaceSearchInput = {query: input.query, countryCode: input.countryCode, city: input.city, language: input.language, near: input.near, limit: input.limit};
  const activity = getAgentActivityStore();
  const activityId = options.viewId ? activity.start({viewId: options.viewId, kind: 'search', title: '地点搜索', query: {...providerInput}}) : undefined;
  try {
  const result = await searchPlacesDetailed(providerInput);
  const now = Date.now();
  for (const [id, entry] of registry) if (entry.expiresAt <= now) registry.delete(id);
  const candidates = result.candidates.map(candidate => {
    const existing = [...registry.entries()].find(([, entry]) => entry.expiresAt === Date.parse(result.expiresAt) && JSON.stringify(entry.candidate) === JSON.stringify(candidate));
    const candidateId = existing?.[0] ?? `candidate_${randomUUID()}`;
    registry.set(candidateId, { candidate: structuredClone(candidate), expiresAt: Date.parse(result.expiresAt) });
    return { ...candidate, candidateId };
  });
  while (registry.size > 4000) registry.delete(registry.keys().next().value!);
  if (activityId) activity.update(activityId, {status: result.status === 'failed' || result.status === 'not_configured' ? 'failed' : 'completed', candidates, providerStatus: result.providerStatus, cached: result.cached, message: result.status === 'not_configured' ? '未配置可用的地点搜索来源' : result.status === 'failed' ? '搜索来源暂时不可用，请重试' : result.status === 'partial' ? '部分来源不可用，已保留可用结果' : candidates.length ? `找到 ${candidates.length} 个候选地点` : '搜索完成，未找到候选地点'});
  return { ...result, candidates, contextHandling: {
    countryCode: 'LocationIQ country restriction; Gaode skipped for non-CN',
    city: 'Gaode city restriction; LocationIQ city appended to query (not an exact administrative boundary filter)',
    language: 'LocationIQ accept-language; Gaode does not offer language selection',
    near: 'LocationIQ viewbox preference, not radius restriction; Gaode place/text does not support near',
  } };
  } catch (error) {
    if (activityId) activity.update(activityId, {status: 'failed', error: '地点搜索失败，请检查输入或稍后重试'});
    throw error;
  }
}
export function markCandidateAdopted(candidateId: string, viewId?: string) {
  if (!viewId) return;
  const store = getAgentActivityStore();
  for (const activity of store.list(viewId)) {
    if (activity.kind !== 'search' || !activity.candidates?.some(candidate => candidate.candidateId === candidateId)) continue;
    store.update(activity.id, {selectedCandidateIds: [...new Set([...(activity.selectedCandidateIds ?? []), candidateId])]});
  }
}
export function resolveCandidate(candidateId: string): DetailedCandidate {
  const entry = registry.get(candidateId);
  if (!entry || entry.expiresAt <= Date.now()) {
    registry.delete(candidateId);
    throw Object.assign(new Error('Place candidate expired or unknown; search again'), { code: 'CANDIDATE_EXPIRED' });
  }
  return structuredClone(entry.candidate);
}
