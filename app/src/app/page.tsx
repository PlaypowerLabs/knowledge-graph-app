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

// Which relationship types define containment / tree edges. Expanding a node
// reveals its children along these edges only; cross-edges (supports,
// hasStandardAlignment, etc.) render automatically when both endpoints exist.
const CONTAINMENT_EDGES = new Set(['hasChild', 'hasPart']);

function buildChildrenMap(edges: GraphEdge[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const e of edges) {
    if (!CONTAINMENT_EDGES.has(e.label)) continue;
    const arr = m.get(e.source);
    if (arr) arr.push(e.target);
    else m.set(e.source, [e.target]);
  }
  return m;
}

export default function Page() {
  const [frameworks, setFrameworks] = useState<FrameworkOption[]>([]);
  const [frameworkId, setFrameworkId] = useState<string>('');
  const [includeCurriculum, setIncludeCurriculum] = useState(false);
  const [graph, setGraph] = useState<SubgraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

  const childrenMap = useMemo(
    () => (graph ? buildChildrenMap(graph.edges) : new Map<string, string[]>()),
    [graph],
  );

  useEffect(() => {
    fetch('/api/frameworks')
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
    const params = new URLSearchParams({
      framework: frameworkId,
      curriculum: String(includeCurriculum),
    });
    fetch(`/api/subgraph?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: SubgraphResponse) => {
        setGraph(data);
        setSelected(null);
        // Default view: framework + its direct children so the user sees something
        // immediately but doesn't drown in all 1,500 nodes.
        const m = buildChildrenMap(data.edges);
        const initial = new Set<string>([frameworkId]);
        for (const c of m.get(frameworkId) || []) initial.add(c);
        setVisibleIds(initial);
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(String(e));
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [frameworkId, includeCurriculum]);

  const toggleChildren = useCallback(
    (nodeId: string) => {
      setVisibleIds((prev) => {
        const children = childrenMap.get(nodeId) || [];
        if (!children.length) return prev;
        const next = new Set(prev);
        const anyVisible = children.some((c) => next.has(c));
        if (anyVisible) {
          // Collapse: remove the entire subtree (children, grandchildren, ...).
          const stack = [...children];
          while (stack.length) {
            const cur = stack.pop()!;
            if (!next.has(cur)) continue;
            next.delete(cur);
            for (const c of childrenMap.get(cur) || []) stack.push(c);
          }
        } else {
          for (const c of children) next.add(c);
        }
        return next;
      });
    },
    [childrenMap],
  );

  const expandSubtree = useCallback(
    (nodeId: string) => {
      setVisibleIds((prev) => {
        const next = new Set(prev);
        next.add(nodeId);
        const queue = [nodeId];
        while (queue.length) {
          const cur = queue.shift()!;
          for (const c of childrenMap.get(cur) || []) {
            if (!next.has(c)) {
              next.add(c);
              queue.push(c);
            }
          }
        }
        return next;
      });
    },
    [childrenMap],
  );

  const expandAll = useCallback(() => {
    if (!graph) return;
    setVisibleIds(new Set(graph.nodes.map((n) => n.id)));
  }, [graph]);

  const collapseAll = useCallback(() => {
    if (!frameworkId) return;
    setVisibleIds(new Set([frameworkId]));
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

        <label>
          <input
            type="checkbox"
            checked={includeCurriculum}
            onChange={(e) => setIncludeCurriculum(e.target.checked)}
          />
          Include curriculum
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
          onExpandSubtree={expandSubtree}
        />
        <Legend />
        <NodeDetail node={selected} onClose={() => setSelected(null)} />
      </div>
    </div>
  );
}
