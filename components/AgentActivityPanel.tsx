'use client';
import { useEffect, useRef, useState } from 'react';
import { useAppAgentBridge } from '@/components/AppAgentBridge';
import type { AgentActivity } from '@/lib/server/agentActivity';

const providerNames: Record<string, string> = {gaode: '高德地图', locationiq: 'LocationIQ'};
const providerStates: Record<string, string> = {ok: '完成', failed: '暂不可用', not_configured: '未配置', not_applicable: '不适用'};
const statusLabel = (activity: AgentActivity) => activity.status === 'running' ? (activity.kind === 'plan' ? '执行中' : '搜索中') : activity.status === 'failed' ? '未完成' : '已完成';
const queryValue = (value: unknown) => typeof value === 'object' ? JSON.stringify(value) : String(value);
export function AgentActivityPanel() {
 const bridge = useAppAgentBridge();const viewId = bridge?.state.viewId;
 const [activities, setActivities] = useState<AgentActivity[]>([]);
 const [expanded, setExpanded] = useState(true), [history, setHistory] = useState(false);
 const [selectedId, setSelectedId] = useState<string | null>(null);
 const [connected, setConnected] = useState(true), [now, setNow] = useState(Date.now);
 const newestId = useRef<string | undefined>(undefined);
 useEffect(() => {
  if (!viewId) return;
  newestId.current = undefined;
  const stream = new EventSource(`/api/agent-events?viewId=${encodeURIComponent(viewId)}`);
  stream.onopen = () => setConnected(true);
  stream.onerror = () => setConnected(false);
  stream.onmessage = event => {
   try {
    const snapshot = JSON.parse(event.data) as {type: string; activities: AgentActivity[]};
    if (snapshot.type !== 'snapshot' || !Array.isArray(snapshot.activities)) return;
    const records = snapshot.activities.filter(item => item.viewId === viewId);
    const newest = records.at(-1);
    if (newest && newest.id !== newestId.current) {
     newestId.current = newest.id;setSelectedId(newest.id);setExpanded(true);setHistory(false);
    }
    setActivities(records);
   } catch { /* A malformed event is ignored; EventSource reconnects independently. */ }
  };
  return () => stream.close();
 }, [viewId]);
 const running = activities.some(item => item.status === 'running');
 useEffect(() => {if (!running) return;const timer = setInterval(() => setNow(Date.now()), 1000);return () => clearInterval(timer);}, [running]);
 const current = activities.find(item => item.id === selectedId) ?? activities.at(-1);
 if (!current) return null;
 const isPlan = current.kind === 'plan';
 const panelLabel = isPlan ? '计划执行进度' : '地点搜索记录';
 const seconds = (Math.max(0, current.status === 'running' ? now - current.startedAt : current.durationMs ?? current.updatedAt - current.startedAt) / 1000).toFixed(1);
 return <aside className={`agent-search-panel ${expanded ? 'is-expanded' : ''}`} aria-label={isPlan ? "Agent 计划执行活动" : "Agent 搜索活动"}>
  <span className="agent-search-panel-live" role="status" aria-live="polite">{current.title}，{statusLabel(current)}{current.message ? `，${current.message}` : ''}</span>
  {!expanded ? <button className="agent-search-panel-trigger" onClick={() => setExpanded(true)} aria-expanded={false} aria-controls="agent-search-panel-content"><span className={`agent-search-panel-dot ${running ? 'is-running' : ''}`} />Agent {isPlan ? '计划' : '搜索'}<span>{running ? '进行中' : `${activities.length} 条记录`}</span></button> : <>
   <header className="agent-search-panel-header">
    <div><span className="agent-search-panel-eyebrow">AGENT / {isPlan ? 'PLAN PROGRESS' : 'SEARCH LOG'}</span><h2>{panelLabel}</h2></div>
    <div className="agent-search-panel-actions">
     <button title={`收起${panelLabel}`} aria-label={`收起${panelLabel}`} onClick={() => setExpanded(false)}>−</button>
     <button title="关闭活动浮层，保留记录" aria-label="关闭活动浮层，保留记录" onClick={() => setExpanded(false)}>×</button>
    </div>
   </header>
   <div id="agent-search-panel-content" className="agent-search-panel-content">
    {!connected && <p className="agent-search-panel-notice">连接中断，正在重连；以下为最近收到的记录。</p>}
    <div className="agent-search-panel-meta"><span className={`agent-search-panel-state ${current.status}`}><span className={`agent-search-panel-dot ${current.status === 'running' ? 'is-running' : ''}`} />{statusLabel(current)}</span><span>{seconds}s{current.cached ? ' · 缓存命中' : current.cached === false ? ' · 实时查询' : ''}</span></div>
    {current.step && <p className="agent-search-panel-step">步骤 {current.step.index}/{current.step.total} · {current.step.label}</p>}
    <h3 className="agent-search-panel-query">{typeof current.query?.query === 'string' ? current.query.query : current.title}</h3>
    {current.query && <dl className="agent-search-panel-context">{Object.entries(current.query).filter(([key,value]) => key !== 'query' && value !== undefined).map(([key,value]) => <div key={key}><dt>{({countryCode: '国家', city: '城市', language: '语言', near: '位置偏好', limit: '结果上限'} as Record<string,string>)[key] ?? key}</dt><dd>{queryValue(value)}</dd></div>)}</dl>}
    {current.providerStatus && <div className="agent-search-panel-providers">{current.providerStatus.map(provider => <span key={provider.provider} data-status={provider.status}>{providerNames[provider.provider] ?? provider.provider}<small>{providerStates[provider.status] ?? provider.status}</small></span>)}</div>}
    {(current.error || current.message) && <p className="agent-search-panel-message">{current.error || current.message}</p>}
    {!isPlan && current.status === 'running' && !current.candidates?.length && <p className="agent-search-panel-wait">正在向地点来源查询候选…</p>}
    {!!current.candidates?.length && <ol className="agent-search-panel-candidates">{current.candidates.map((candidate,index) => {
     const adopted = current.selectedCandidateIds?.includes(candidate.candidateId);
     return <li key={candidate.candidateId} className={adopted ? 'is-adopted' : ''}><span className="agent-search-panel-number">{String(index+1).padStart(2,'0')}</span><div><div className="agent-search-panel-candidate-title"><strong>{candidate.name}</strong>{adopted && <span className="agent-search-panel-adopted">已采用</span>}</div><p>{candidate.displayName}</p><small>{providerNames[candidate.provider] ?? candidate.provider} · {candidate.latitude.toFixed(4)}, {candidate.longitude.toFixed(4)}</small></div></li>;
    })}</ol>}
    {current.status === 'completed' && !!current.candidates?.length && !current.selectedCandidateIds?.length && <p className="agent-search-panel-pending">候选已返回，等待 Agent 采用。</p>}
    <button className="agent-search-panel-history-toggle" onClick={() => setHistory(value => !value)} aria-expanded={history}>最近记录 <span>{activities.length} / 30</span><span>{history ? '收起 ↑' : '展开 ↓'}</span></button>
    {history && <ol className="agent-search-panel-history">{[...activities].reverse().map(activity => <li key={activity.id}><button aria-pressed={activity.id === current.id} onClick={() => setSelectedId(activity.id)}><span>{typeof activity.query?.query === 'string' ? activity.query.query : activity.title}</span><small>{statusLabel(activity)} · {new Date(activity.startedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</small></button></li>)}</ol>}
   </div>
   <footer className="agent-search-panel-footer">MCP {isPlan ? '计划' : '搜索'} · 仅当前窗口<span>{isPlan ? '按已确认计划执行' : '记录不改变行程'}</span></footer>
  </>}
 </aside>;
}
