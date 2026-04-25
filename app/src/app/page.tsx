'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ChevronsDown, ChevronsUp } from 'lucide-react';
import type { GraphNode, GraphEdge } from '@/components/GraphViewer';
import Legend from '@/components/Legend';
import NodeDetail from '@/components/NodeDetail';

const GraphViewer = dynamic(() => import('@/components/GraphViewer'), { ssr: false });

type FrameworkOption = {
  identifier: string;
  jurisdiction: string | null;
  name: string | null;
};

type SubgraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { nodeCount: number; edgeCount: number; durationMs: number };
};

// Edges whose source -> target is a containment relationship (parent contains
// child). Expanding a node reveals children along these.
const CONTAINMENT_EDGES = new Set(['hasChild', 'hasPart']);
// Edges where the CHILD points to the parent semantically. `supports` runs
// LearningComponent -> Standard, but from a UI containment perspective the
// Standard is the parent that should reveal its supporting LCs on expand.
const REVERSE_CONTAINMENT_EDGES = new Set(['supports']);

function buildChildrenMap(edges: GraphEdge[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const push = (k: string, v: string) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  for (const e of edges) {
    if (CONTAINMENT_EDGES.has(e.label)) push(e.source, e.target);
    else if (REVERSE_CONTAINMENT_EDGES.has(e.label)) push(e.target, e.source);
  }
  return m;
}

export default function Page() {
  const [frameworks, setFrameworks] = useState<FrameworkOption[]>([]);
  const [frameworkId, setFrameworkId] = useState<string>('');
  const [graph, setGraph] = useState<SubgraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  // Track which nodes the user has explicitly expanded. Visibility is derived
  // (BFS from the framework root through expanded parents), which means a
  // child is visible iff at least one of its expanded parents is visible —
  // the reference-counting behavior for shared children (e.g. a
  // LearningComponent that supports multiple Standards).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const childrenMap = useMemo(
    () => (graph ? buildChildrenMap(graph.edges) : new Map<string, string[]>()),
    [graph],
  );

  const visibleIds = useMemo(() => {
    const s = new Set<string>();
    if (!frameworkId) return s;
    s.add(frameworkId);
    const queue: string[] = [frameworkId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (!expandedIds.has(cur)) continue;
      for (const c of childrenMap.get(cur) || []) {
        if (s.has(c)) continue;
        s.add(c);
        queue.push(c);
      }
    }
    return s;
  }, [frameworkId, expandedIds, childrenMap]);

  useEffect(() => {
    fetch('/subgraphs/frameworks.json')
      .then((r) => r.json())
      .then((data: { frameworks: FrameworkOption[] }) => {
        setFrameworks(data.frameworks);
        const picked =
          data.frameworks.find((f) => f.jurisdiction === 'California') ??
          data.frameworks.find((f) => f.jurisdiction === 'Multi-State') ??
          data.frameworks[0];
        if (picked) setFrameworkId(picked.identifier);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!frameworkId) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/subgraphs/${encodeURIComponent(frameworkId)}_cur.json`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: SubgraphResponse) => {
        setGraph(data);
        setSelected(null);
        // Default view: framework expanded (so its direct children show) but
        // nothing deeper, so the user sees something immediately without
        // drowning in all 1,500 nodes.
        setExpandedIds(new Set([frameworkId]));
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(String(e));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [frameworkId]);

  const toggleChildren = useCallback(
    (nodeId: string) => {
      setExpandedIds((prev) => {
        const children = childrenMap.get(nodeId) || [];
        if (!children.length) return prev;
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      });
    },
    [childrenMap],
  );

  const expandAll = useCallback(() => {
    if (!graph) return;
    // Expand every node that has any containment children; `visibleIds` then
    // reaches the whole graph via BFS.
    const all = new Set<string>();
    for (const [id] of childrenMap) all.add(id);
    setExpandedIds(all);
  }, [graph, childrenMap]);

  const collapseAll = useCallback(() => {
    if (!frameworkId) return;
    // Leave no nodes expanded: only the framework root remains visible.
    setExpandedIds(new Set());
  }, [frameworkId]);

  const displayedNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((n) => visibleIds.has(n.id));
  }, [graph, visibleIds]);

  const displayedEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  }, [graph, visibleIds]);

  // A node is "collapsed" when it has containment children but none are visible.
  const collapsedIds = useMemo(() => {
    const s = new Set<string>();
    for (const n of displayedNodes) {
      const children = childrenMap.get(n.id);
      if (!children || children.length === 0) continue;
      if (!children.some((c) => visibleIds.has(c))) s.add(n.id);
    }
    return s;
  }, [displayedNodes, childrenMap, visibleIds]);

  const activeFramework = useMemo(
    () => frameworks.find((f) => f.identifier === frameworkId) ?? null,
    [frameworks, frameworkId],
  );

  return (
    <div className="app">
      <div className="toolbar">
        <span className="title">Knowledge Graph · Mathematics</span>

        <label>
          Framework
          <select value={frameworkId} onChange={(e) => setFrameworkId(e.target.value)}>
            {frameworks.map((f) => (
              <option key={f.identifier} value={f.identifier}>
                {f.jurisdiction ?? '(unknown)'}
                {f.name ? ` — ${f.name}` : ''}
              </option>
            ))}
          </select>
        </label>

        <span className="divider" />

        <button onClick={expandAll} disabled={!graph} title="Show every node">
          <ChevronsDown size={14} />
          Expand all
        </button>
        <button onClick={collapseAll} disabled={!frameworkId} title="Collapse to root only">
          <ChevronsUp size={14} />
          Collapse all
        </button>

        <div className="stats">
          {error ? (
            <span style={{ color: '#c0392b' }}>{error}</span>
          ) : graph ? (
            <>
              {displayedNodes.length.toLocaleString()} / {graph.stats.nodeCount.toLocaleString()} nodes ·{' '}
              {displayedEdges.length.toLocaleString()} edges
              {activeFramework?.jurisdiction ? ` · ${activeFramework.jurisdiction}` : ''}
            </>
          ) : (
            '…'
          )}
          <Link
            href="/coherence"
            style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}
          >
            Coherence Map →
          </Link>
          <Link
            href="/curriculum"
            style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}
          >
            Curriculum →
          </Link>
          <Link
            href="/documents"
            style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}
          >
            Docs →
          </Link>
        </div>
      </div>

      <div style={{ position: 'relative', height: '100%', minHeight: 0 }}>
        <GraphViewer
          nodes={displayedNodes}
          edges={displayedEdges}
          collapsedIds={collapsedIds}
          childrenMap={childrenMap}
          loading={loading}
          onSelectNode={setSelected}
          onToggleChildren={toggleChildren}
        />
        <Legend />
        <NodeDetail node={selected} onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}
