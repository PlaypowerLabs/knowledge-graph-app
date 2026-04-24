'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronsDown, ChevronsUp, X } from 'lucide-react';
import {
  type CoherenceFocus as FocusData,
  type CoherenceGraph,
  type CoherenceIndex,
  type CoherenceNode,
  domainColor,
  domainName,
  plainifyDescription,
} from '@/lib/coherence';
import CoherenceGrid from '@/components/CoherenceGrid';

// Network renderer uses vis-network, which pokes at `window`; load client-only.
const CoherenceFocus = dynamic(() => import('@/components/CoherenceFocus'), { ssr: false });

export default function CoherencePage() {
  const [graph, setGraph] = useState<CoherenceGraph | null>(null);
  const [index, setIndex] = useState<CoherenceIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [focusCode, setFocusCode] = useState<string | null>(null);
  const [focusData, setFocusData] = useState<FocusData | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [query, setQuery] = useState('');

  // Initial load: graph + index + ?focus= param.
  useEffect(() => {
    Promise.all([
      fetch('/coherence/graph.json').then((r) => r.json()),
      fetch('/coherence/index.json').then((r) => r.json()),
    ])
      .then(([g, i]) => {
        setGraph(g as CoherenceGraph);
        setIndex(i as CoherenceIndex);
      })
      .catch((e) => setError(String(e)));

    const params = new URLSearchParams(window.location.search);
    const initial = params.get('focus');
    if (initial) setFocusCode(initial);
  }, []);

  // When focus changes, fetch its precomputed ego network and sync the URL.
  useEffect(() => {
    if (!focusCode || !index) {
      setFocusData(null);
      syncUrl(null);
      return;
    }
    syncUrl(focusCode);
    const uuid = index.byCode[focusCode];
    if (!uuid) {
      setFocusData(null);
      setError(`No such standard: ${focusCode}`);
      return;
    }
    setError(null);
    setFocusLoading(true);
    const ctrl = new AbortController();
    fetch(`/coherence/focus/${encodeURIComponent(uuid)}.json`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: FocusData) => setFocusData(d))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') {
          // Standard has no precomputed focus file (e.g., orphan Mathematical
          // Practice standards). Surface a light message instead of crashing.
          setFocusData(null);
          setError(`No progression edges recorded for ${focusCode}.`);
        }
      })
      .finally(() => setFocusLoading(false));
    return () => ctrl.abort();
  }, [focusCode, index]);

  const handleSelect = useCallback((code: string) => {
    setFocusCode(code);
  }, []);

  const handleClear = useCallback(() => {
    setFocusCode(null);
  }, []);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!graph || !index) return;
      const q = query.trim();
      if (!q) return;
      // Exact code match first.
      if (index.byCode[q]) {
        setFocusCode(q);
        return;
      }
      // Fallback: match the first node whose description contains the keyword
      // (case-insensitive), preferring lower grades.
      const hit = graph.nodes
        .filter((n) => n.code && n.description)
        .find((n) => n.description!.toLowerCase().includes(q.toLowerCase()));
      if (hit?.code) setFocusCode(hit.code);
      else setError(`No match for "${q}"`);
    },
    [graph, index, query],
  );

  // UUIDs in the lineage of the currently-focused standard — used to soft-
  // highlight those cells in the overview grid.
  const highlightUuids = useMemo(() => {
    const s = new Set<string>();
    if (!focusData) return s;
    if (focusData.focus.caseIdentifierUUID) s.add(focusData.focus.caseIdentifierUUID);
    for (const n of focusData.ancestors) if (n.caseIdentifierUUID) s.add(n.caseIdentifierUUID);
    for (const n of focusData.descendants) if (n.caseIdentifierUUID) s.add(n.caseIdentifierUUID);
    return s;
  }, [focusData]);

  const focusNode: CoherenceNode | null = focusData?.focus ?? null;

  return (
    <div className="coh-app">
      <div className="toolbar">
        <span className="title">SAP Coherence Map · CCSS-M</span>

        <form onSubmit={handleSearch} style={{ display: 'inline-flex', gap: 6 }}>
          <input
            type="text"
            placeholder="Search by code (e.g. 3.NF.A.1) or keyword"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">Find</button>
        </form>

        {focusCode && (
          <button onClick={handleClear} title="Clear focus">
            <X size={14} />
            Clear
          </button>
        )}

        <div className="stats">
          {error ? (
            <span style={{ color: '#c0392b' }}>{error}</span>
          ) : graph ? (
            <>
              {graph.stats.nodeCount.toLocaleString()} standards ·{' '}
              {graph.stats.edgesByLabel.buildsTowards ?? 0} buildsTowards edges
            </>
          ) : (
            'Loading…'
          )}
          <Link href="/" style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}>
            ← KG Viewer
          </Link>
        </div>
      </div>

      <div className="coh-body">
        <div className="coh-grid-scroll">
          {graph ? (
            <CoherenceGrid
              graph={graph}
              focusCode={focusCode}
              highlightUuids={highlightUuids}
              onSelect={handleSelect}
            />
          ) : (
            <div className="coh-loading">Loading graph…</div>
          )}
        </div>

        {focusCode && (
          <aside className="coh-drawer">
            <div className="coh-drawer-head">
              <div>
                <div className="coh-drawer-code">{focusCode}</div>
                {focusNode?.grade && (
                  <div className="coh-drawer-sub">
                    Grade {focusNode.grade} · {domainName(focusNode.domain)}
                  </div>
                )}
              </div>
              <button onClick={handleClear} className="coh-drawer-close" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {focusLoading && <div className="coh-loading">Loading ego network…</div>}

            {focusNode?.description && (
              <p className="coh-drawer-desc">{plainifyDescription(focusNode.description)}</p>
            )}

            {focusData && (
              <>
                <div className="coh-drawer-graph">
                  <CoherenceFocus data={focusData} onSelectNode={handleSelect} />
                </div>

                <LineageList
                  title="Prerequisites"
                  focusId={focusData.focus.id}
                  nodes={focusData.ancestors}
                  edges={focusData.edges}
                  direction="backward"
                  onSelect={handleSelect}
                />
                <LineageList
                  title="Subsequents"
                  focusId={focusData.focus.id}
                  nodes={focusData.descendants}
                  edges={focusData.edges}
                  direction="forward"
                  onSelect={handleSelect}
                />
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function LineageList({
  title,
  focusId,
  nodes,
  edges,
  direction,
  onSelect,
}: {
  title: string;
  focusId: string;
  nodes: CoherenceNode[];
  edges: { source: string; target: string }[];
  direction: 'forward' | 'backward';
  onSelect: (code: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  // Direct neighbors are the nodes directly connected to the focus. Anything
  // else is a transitive ancestor/descendant — surfaced behind a toggle so the
  // default view stays readable.
  const { direct, transitive } = useMemo(() => {
    const directIds = new Set<string>();
    for (const e of edges) {
      if (direction === 'backward' && e.target === focusId) directIds.add(e.source);
      if (direction === 'forward' && e.source === focusId) directIds.add(e.target);
    }
    const directArr: CoherenceNode[] = [];
    const transArr: CoherenceNode[] = [];
    for (const n of nodes) {
      if (directIds.has(n.id)) directArr.push(n);
      else transArr.push(n);
    }
    return { direct: directArr, transitive: transArr };
  }, [edges, focusId, direction, nodes]);

  if (!nodes.length) return null;
  const visible = showAll ? [...direct, ...transitive] : direct;

  return (
    <div className="coh-lineage">
      <h4>
        {title} <span className="coh-lineage-count">{direct.length} direct</span>
        {transitive.length > 0 && (
          <button
            type="button"
            className="coh-lineage-toggle"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
            {showAll ? 'Hide' : `+${transitive.length} transitive`}
          </button>
        )}
      </h4>
      <div className="coh-chips">
        {visible.map((n) => (
          <button
            key={n.id}
            type="button"
            className="coh-chip"
            title={n.description?.slice(0, 240) ?? ''}
            onClick={() => n.code && onSelect(n.code)}
            style={{ borderColor: domainColor(n.domain) }}
          >
            <span className="coh-chip-grade">{n.grade}</span>
            {n.code}
          </button>
        ))}
      </div>
    </div>
  );
}

function syncUrl(code: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('focus', code);
  else url.searchParams.delete('focus');
  window.history.replaceState(null, '', url.toString());
}
