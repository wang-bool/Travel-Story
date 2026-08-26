"use client";

import { useEffect, useRef, useState } from "react";
import { STOP_TYPE_LABEL } from "@/lib/types";
import type { SearchResult, StopType } from "@/lib/types";

export function PlaceSearch({
  onPick,
  onCancel,
  onHover,
}: {
  onPick: (r: SearchResult) => void;
  onCancel?: () => void;
  onHover?: (r: SearchResult | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [highlight, setHighlight] = useState(0);
  /** 结果框朝上展开（输入框太靠近视口底部时，免得结果被挡还要手动滚） */
  const [dropUp, setDropUp] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // 打开搜索框时，把它滚进可视区（在行程尾部添加地点时尤其重要）
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  // 结果出来以后量一下：下方不够 340px 且上方更宽，就让结果框朝上展开
  useEffect(() => {
    if (!results.length || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const spaceDown = window.innerHeight - r.bottom;
    setDropUp(spaceDown < 340 && r.top > spaceDown);
  }, [results]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const c = new AbortController();
      abortRef.current = c;
      // 走服务端代理：key 不进前端；未配置 key 时服务端返回 configured:false
      fetch(`/api/geocode?q=${encodeURIComponent(term)}`, { signal: c.signal })
        .then((res) => (res.ok ? res.json() : { results: [], configured: true }))
        .then((data: { results: SearchResult[]; configured?: boolean }) => {
          setConfigured(data.configured !== false);
          setResults(data.results ?? []);
          setHighlight(0);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 280);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onCancel?.();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onCancel]);

  function choose(r: SearchResult) {
    onPick(r);
    setQ("");
    setResults([]);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = Math.min(highlight + 1, results.length - 1);
      setHighlight(h);
      onHover?.(results[h] ?? null);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = Math.max(highlight - 1, 0);
      setHighlight(h);
      onHover?.(results[h] ?? null);
    } else if (e.key === "Enter" && results[highlight]) {
      e.preventDefault();
      choose(results[highlight]);
    } else if (e.key === "Escape") {
      onCancel?.();
    }
  }

  return (
    <div className="search" ref={boxRef}>
      <input
        autoFocus
        className="search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder="搜索地点，国内外都行，例如：埃菲尔铁塔、外滩…"
      />
      {loading && <div className="search-hint font-mono">搜索中…</div>}
      {!loading && results.length > 0 && (
        <ul className={`search-results${dropUp ? " up" : ""}`}>
          {results.map((r, i) => {
            // displayName 可能用中文"，"或英文","分隔；取名称之后的部分作为地址
            const addr = r.displayName
              .split(/[,，]/)
              .slice(1)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 4)
              .join(" · ");
            return (
              <li
                key={r.id}
                className={i === highlight ? "active" : ""}
                onMouseEnter={() => {
                  setHighlight(i);
                  onHover?.(r);
                }}
                onMouseLeave={() => onHover?.(null)}
                onClick={() => choose(r)}
              >
                <span className="search-name">{r.name}</span>
                <span className="search-addr font-mono">{addr || r.displayName}</span>
                <span className="search-type">
                  {STOP_TYPE_LABEL[r.type as StopType] ?? "地点"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {!loading && q.trim().length > 1 && results.length === 0 && (
        <div className="search-hint">
          {configured
            ? "没有找到地点，试试更具体的名称？"
            : "搜索未启用：请按 .env.example 配置 GAODE_KEY / LOCATIONIQ_KEY"}
        </div>
      )}
    </div>
  );
}
