'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronsDown, ChevronsUp, X } from 'lucide-react';
import {
  type CurriculumFocus as FocusData,
  type CurriculumGraph,
  type CurriculumIndex,
  type CurriculumNode,
  bandColor,
  prettyCourse,
} from '@/lib/curriculum';
import type { Alignments, AlignedStandard } from '@/lib/alignments';
import CurriculumGrid from '@/components/CurriculumGrid';

const CurriculumFocus = dynamic(() => import('@/components/CurriculumFocus'), { ssr: false });

export default function CurriculumPage() {
  const [graph, setGraph] = useState<CurriculumGraph | null>(null);
  const [index, setIndex] = useState<CurriculumIndex | null>(null);
  const [alignments, setAlignments] = useState<Alignments | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusData, setFocusData] = useState<FocusData | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/curriculum/graph.json').then((r) => r.json()),
      fetch('/curriculum/index.json').then((r) => r.json()),
      fetch('/alignments.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([g, i, a]) => {
        setGraph(g as CurriculumGraph);
        setIndex(i as CurriculumIndex);
        if (a) setAlignments(a as Alignments);
      })
      .catch((e) => setError(String(e)));

    // Deep link uses `shortId` (no prefix, URL-friendly).
    const params = new URLSearchParams(window.location.search);
    const initial = params.get('focus');
    if (initial) setFocusId(`im:${initial}`);
  }, []);

  useEffect(() => {
    if (!focusId || !index) {
      setFocusData(null);
      syncUrl(null);
      return;
    }
    const summary = index.byId[focusId];
    const shortId = summary?.shortId ?? focusId.replace(/^im:/, '');
    syncUrl(shortId);
    setError(null);
    setFocusLoading(true);
    const ctrl = new AbortController();
    fetch(`/curriculum/focus/${encodeURIComponent(shortId)}.json`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: FocusData) => setFocusData(d))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') {
          setFocusData(null);
          setError(`No dependency edges recorded for ${summary?.name ?? focusId}.`);
        }
      })
      .finally(() => setFocusLoading(false));
    return () => ctrl.abort();
  }, [focusId, index]);

  const handleSelect = useCallback((id: string) => {
    setFocusId(id);
  }, []);

  const handleClear = useCallback(() => {
    setFocusId(null);
  }, []);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!graph) return;
      const q = query.trim().toLowerCase();
      if (!q) return;
      const hit = graph.nodes.find((n) => n.name?.toLowerCase().includes(q));
      if (hit) setFocusId(hit.id);
      else setError(`No unit matching "${query}"`);
    },
    [graph, query],
  );

  const highlightIds = useMemo(() => {
    const s = new Set<string>();
    if (!focusData) return s;
    s.add(focusData.focus.id);
    for (const n of focusData.ancestors) s.add(n.id);
    for (const n of focusData.descendants) s.add(n.id);
    return s;
  }, [focusData]);

  const focusNode: CurriculumNode | null = focusData?.focus ?? null;

  return (
    <div className="curr-app">
      <div className="toolbar">
        <span className="title">IM 360 Curriculum · Unit Dependencies</span>

        <form onSubmit={handleSearch} style={{ display: 'inline-flex', gap: 6 }}>
          <input
            type="text"
            placeholder="Search unit name (e.g. Pythagorean)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">Find</button>
        </form>

        {focusId && (
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
              {graph.stats.nodeCount.toLocaleString()} units ·{' '}
              {graph.stats.edgesByLabel.hasDependency ?? 0} hasDependency edges
            </>
          ) : (
            'Loading…'
          )}
          <Link
            href="/coherence"
            style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}
          >
            Coherence Map →
          </Link>
          <Link href="/" style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}>
            ← KG Viewer
          </Link>
        </div>
      </div>

      <div className="curr-body">
        <div className="curr-grid-scroll">
          {graph ? (
            <CurriculumGrid
              graph={graph}
              focusId={focusId}
              highlightIds={highlightIds}
              onSelect={handleSelect}
            />
          ) : (
            <div className="curr-loading">Loading graph…</div>
          )}
        </div>

        {focusId && (
          <aside className="curr-drawer">
            <div className="curr-drawer-head">
              <div>
                <div className="curr-drawer-name">{focusNode?.name ?? '…'}</div>
                {focusNode && (
                  <div className="curr-drawer-sub">
                    {prettyCourse(focusNode.courseCode)}
                    {focusNode.ordinalName ? ` · ${focusNode.ordinalName}` : ''}
                    {focusNode.band ? ` · ${focusNode.band} School` : ''}
                  </div>
                )}
              </div>
              <button onClick={handleClear} className="curr-drawer-close" aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {focusLoading && <div className="curr-loading">Loading ego network…</div>}

            {focusData && (
              <>
                <div className="curr-drawer-graph">
                  <CurriculumFocus data={focusData} onSelectNode={handleSelect} />
                </div>

                <LineageList
                  title="Prerequisite units"
                  focusId={focusData.focus.id}
                  nodes={focusData.ancestors}
                  edges={focusData.edges}
                  direction="backward"
                  onSelect={handleSelect}
                />
                <LineageList
                  title="Dependent units"
                  focusId={focusData.focus.id}
                  nodes={focusData.descendants}
                  edges={focusData.edges}
                  direction="forward"
                  onSelect={handleSelect}
                />

                <AlignedStandards
                  standards={alignments?.unitToStandards[focusData.focus.id] ?? []}
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
  nodes: CurriculumNode[];
  edges: { source: string; target: string }[];
  direction: 'forward' | 'backward';
  onSelect: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const { direct, transitive } = useMemo(() => {
    const directIds = new Set<string>();
    for (const e of edges) {
      if (direction === 'backward' && e.target === focusId) directIds.add(e.source);
      if (direction === 'forward' && e.source === focusId) directIds.add(e.target);
    }
    const d: CurriculumNode[] = [];
    const t: CurriculumNode[] = [];
    for (const n of nodes) (directIds.has(n.id) ? d : t).push(n);
    return { direct: d, transitive: t };
  }, [edges, focusId, direction, nodes]);

  if (!nodes.length) return null;
  const visible = showAll ? [...direct, ...transitive] : direct;

  return (
    <div className="curr-lineage">
      <h4>
        {title} <span className="curr-lineage-count">{direct.length} direct</span>
        {transitive.length > 0 && (
          <button
            type="button"
            className="curr-lineage-toggle"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
            {showAll ? 'Hide' : `+${transitive.length} transitive`}
          </button>
        )}
      </h4>
      <div className="curr-chips">
        {visible.map((n) => (
          <button
            key={n.id}
            type="button"
            className="curr-chip"
            title={n.name ?? ''}
            onClick={() => onSelect(n.id)}
            style={{ borderColor: bandColor(n.band) }}
          >
            <span className="curr-chip-course">{prettyCourse(n.courseCode)}</span>
            {n.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// Cross-link into /coherence. CCSS-M standards this unit covers, each chip
// jumps to the corresponding standard's coherence focus view.
function AlignedStandards({ standards }: { standards: AlignedStandard[] }) {
  if (!standards.length) return null;
  return (
    <div className="curr-lineage">
      <h4>
        Aligned CCSS-M standards{' '}
        <span className="curr-lineage-count">{standards.length}</span>
      </h4>
      <div className="curr-chips">
        {standards.map((s) => (
          <Link
            key={s.id}
            href={`/coherence?focus=${encodeURIComponent(s.code ?? '')}`}
            className="curr-chip"
            title={s.code ?? ''}
            style={{ borderColor: '#4a90e2', maxWidth: 140 }}
          >
            <span className="curr-chip-course">CCSS-M</span>
            {s.code}
          </Link>
        ))}
      </div>
    </div>
  );
}

function syncUrl(shortId: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (shortId) url.searchParams.set('focus', shortId);
  else url.searchParams.delete('focus');
  window.history.replaceState(null, '', url.toString());
}
