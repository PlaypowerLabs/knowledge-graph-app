'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { htmlToPlainText, formatGradeLevel } from '@/lib/text';

export type GraphNode = {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
};
export type GraphEdge = {
  id: string;
  label: string;
  source: string;
  target: string;
  properties: Record<string, unknown>;
};

// Keys here are "display kinds", not raw graph labels. A StandardsFrameworkItem
// splits into two kinds based on normalizedStatementType so that structural
// containers (Domain / Cluster / Strand / Grade Level) look different from
// leaf standards. See colorKey() below.
export const LABEL_COLORS: Record<string, string> = {
  StandardsFramework: '#d13434',
  'Standard Grouping': '#1e40af',
  Standard: '#4a90e2',
  LearningComponent: '#9b59b6',
  Course: '#16a085',
  LessonGrouping: '#1abc9c',
  Lesson: '#2ecc71',
  Activity: '#f39c12',
  Assessment: '#e67e22',
};

export const EDGE_COLORS: Record<string, string> = {
  hasChild: '#8a98a6',
  hasPart: '#627387',
  hasEducationalAlignment: '#3498db',
  supports: '#9b59b6',
  hasStandardAlignment: '#e74c3c',
  buildsTowards: '#f1c40f',
  hasReference: '#34495e',
  relatesTo: '#95a5a6',
  hasDependency: '#c0392b',
  mutuallyExclusiveWith: '#8e44ad',
};

// No visible border on any node. Shape and fill colour do all the work.
const NO_BORDER_WIDTH = 0;

function nodeDisplayLabel(n: GraphNode): string {
  const p = n.properties as Record<string, string | undefined>;
  const pick = n.labels.includes('StandardsFramework')
    ? p.name || p.jurisdiction
    : n.labels.includes('StandardsFrameworkItem')
    ? p.statementCode
    : p.name || p.ordinalName;
  const cleaned = htmlToPlainText(pick).split('\n')[0];
  return cleaned || n.id.slice(0, 8);
}

function buildTooltipElement(n: GraphNode): HTMLElement {
  const root = document.createElement('div');
  root.style.cssText =
    'max-width:360px;font-size:12px;line-height:1.45;font-family:system-ui,-apple-system,sans-serif;color:#222';
  const p = n.properties as Record<string, string | undefined>;

  const addRow = (label: string | null, value: string, emphasize = false) => {
    const row = document.createElement('div');
    row.style.margin = '1px 0';
    if (label) {
      const s = document.createElement('span');
      s.style.color = '#777';
      s.textContent = `${label}: `;
      row.appendChild(s);
    }
    const v = document.createElement('span');
    if (emphasize) v.style.fontWeight = '600';
    v.textContent = value;
    row.appendChild(v);
    root.appendChild(row);
  };

  addRow(null, n.labels.join(', '), true);
  if (p.statementCode) addRow(null, p.statementCode, true);
  if (p.name) addRow(null, htmlToPlainText(p.name));

  if (p.description) {
    const plain = htmlToPlainText(p.description);
    const clipped = plain.length > 360 ? plain.slice(0, 360) + '…' : plain;
    const d = document.createElement('div');
    d.style.cssText = 'margin-top:6px;white-space:pre-wrap;color:#333';
    d.textContent = clipped;
    root.appendChild(d);
  }

  const grade = formatGradeLevel(p.gradeLevel);
  if (grade) addRow('Grade', grade);
  if (p.jurisdiction) addRow('Jurisdiction', p.jurisdiction);
  return root;
}

// Pick a display kind for a node. StandardsFrameworkItem is split into
// "Standard Grouping" (Domain/Cluster/Strand/...) vs "Standard" (leaf)
// using the normalizedStatementType property, so the two visually diverge.
function colorKey(n: GraphNode): string {
  const primary = n.labels[0];
  if (primary !== 'StandardsFrameworkItem') return primary;
  const nst = (n.properties as { normalizedStatementType?: string }).normalizedStatementType;
  return nst === 'Standard Grouping' ? 'Standard Grouping' : 'Standard';
}

// vis-network shape primer:
//   - dot / square / star / triangle / diamond: size is fixed by `size`,
//     the label renders BELOW the node.
//   - circle / box / database / ellipse / text: the shape grows to fit its
//     label, so text renders INSIDE the node.
// We swap dot <-> circle and square <-> box on collapsed nodes so the
// hidden-children count can live inside the shape.
function nodeShape(kind: string, collapsed: boolean): string {
  if (kind === 'StandardsFramework') return 'star';
  if (kind === 'Course') return 'diamond';
  if (kind === 'Standard Grouping') return collapsed ? 'box' : 'square';
  if (kind === 'LessonGrouping') return 'triangle';
  return collapsed ? 'circle' : 'dot';
}

function nodeSize(kind: string): number {
  if (kind === 'StandardsFramework') return 30;
  if (kind === 'Course') return 22;
  if (kind === 'LessonGrouping') return 16;
  if (kind === 'Standard Grouping') return 10;
  return 9;
}

// Kinds whose collapsed shape (circle / box) can host text inside it.
const INLINE_COUNT_KINDS = new Set([
  'Standard',
  'Standard Grouping',
  'LearningComponent',
  'Lesson',
  'Activity',
  'Assessment',
]);

function buildVisNode(
  n: GraphNode,
  collapsed: boolean,
  hiddenChildCount: number,
): Record<string, unknown> {
  const kind = colorKey(n);
  const bg = LABEL_COLORS[kind] || '#777';
  const baseLabel = nodeDisplayLabel(n).slice(0, 40);

  // Label rules:
  //   - expanded / leaf: show the normal label (statement code, name, ...)
  //   - collapsed AND the shape can contain text: show JUST the child count
  //     inside the node so it reads as a marker.
  //   - collapsed but shape can't host text (star/diamond/triangle): append
  //     the count next to the normal label.
  let label = baseLabel;
  if (collapsed && hiddenChildCount > 0) {
    label = INLINE_COUNT_KINDS.has(kind)
      ? String(hiddenChildCount)
      : `${baseLabel}  +${hiddenChildCount}`;
  }

  const color = {
    background: bg,
    border: bg,
    highlight: { background: bg, border: bg },
    hover: { background: bg, border: bg },
  };

  // Dark fill + dark label = unreadable. Make the inline count render in white.
  const showsInsideCount = collapsed && hiddenChildCount > 0 && INLINE_COUNT_KINDS.has(kind);
  const font = showsInsideCount
    ? { size: 12, color: '#ffffff', face: 'system-ui', bold: true }
    : { size: collapsed ? 12 : 11, color: '#222', face: 'system-ui' };

  const shape = nodeShape(kind, collapsed);
  return {
    id: n.id,
    label,
    title: buildTooltipElement(n),
    color,
    borderWidth: NO_BORDER_WIDTH,
    shape,
    size: nodeSize(kind),
    font,
    widthConstraint: showsInsideCount ? { minimum: 22 } : undefined,
  };
}

function buildVisEdge(e: GraphEdge) {
  return {
    id: e.id,
    from: e.source,
    to: e.target,
    color: { color: EDGE_COLORS[e.label] || '#c4ccd4', opacity: 0.9 },
    title: e.label,
    arrows: 'to',
    width: e.label === 'hasChild' ? 1.2 : 1.6,
    smooth: false,
  };
}

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  collapsedIds?: Set<string>;
  childrenMap?: Map<string, string[]>;
  loading?: boolean;
  onSelectNode?: (n: GraphNode | null) => void;
  onToggleChildren?: (id: string) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VisModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VisNetwork = any;

export default function GraphViewer({
  nodes,
  edges,
  collapsedIds,
  childrenMap,
  loading,
  onSelectNode,
  onToggleChildren,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<VisNetwork | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodesDsRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgesDsRef = useRef<any>(null);
  const [visModule, setVisModule] = useState<VisModule | null>(null);

  // Keep a stable ref to callbacks so we bind event handlers only once.
  const callbacksRef = useRef({ onSelectNode, onToggleChildren, nodes });
  callbacksRef.current = { onSelectNode, onToggleChildren, nodes };

  // Dynamic-import vis-network on the client only.
  useEffect(() => {
    let cancelled = false;
    import('vis-network/standalone').then((mod) => {
      if (!cancelled) setVisModule(mod);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Create the network once, reuse across renders.
  useEffect(() => {
    if (!visModule || !containerRef.current) return;
    const vis = visModule;
    const nodesDs = new vis.DataSet([]);
    const edgesDs = new vis.DataSet([]);
    nodesDsRef.current = nodesDs;
    edgesDsRef.current = edgesDs;

    const network = new vis.Network(
      containerRef.current,
      { nodes: nodesDs, edges: edgesDs },
      {
        layout: { hierarchical: { enabled: false } },
        physics: { enabled: false },
        nodes: {
          font: { size: 11, face: 'system-ui' },
          borderWidth: 0,
          // Applies to every node. `box` would otherwise have rounded corners.
          // All five keys must be present — vis-network reads them unconditionally.
          shapeProperties: {
            borderRadius: 0,
            borderDashes: false,
            interpolation: false,
            useImageSize: false,
            useBorderWithImage: false,
          },
        },
        edges: {
          arrows: { to: { scaleFactor: 0.4 } },
          selectionWidth: 2,
          smooth: false,
        },
        interaction: {
          hover: true,
          tooltipDelay: 140,
          hideEdgesOnDrag: false,
          hideNodesOnDrag: false,
          hideEdgesOnZoom: false,
          navigationButtons: true,
          keyboard: true,
          multiselect: false,
          dragNodes: true,
        },
      },
    );
    networkRef.current = network;
    // Physics lifecycle is owned entirely by the data-sync effect: it turns
    // physics on for a short pulse whenever new nodes appear and turns it back
    // off once stabilization finishes.

    // Single click: select the node (detail pane). Double click: toggle
    // expand/collapse of its children.
    network.on('selectNode', (ev: { nodes: string[] }) => {
      const id = ev.nodes[0];
      if (!id) return;
      const match = callbacksRef.current.nodes.find((n) => n.id === id) ?? null;
      callbacksRef.current.onSelectNode?.(match);
    });
    network.on('deselectNode', () => callbacksRef.current.onSelectNode?.(null));

    network.on('doubleClick', (ev: { nodes: string[] }) => {
      const id = ev.nodes[0];
      if (!id) return;
      callbacksRef.current.onToggleChildren?.(id);
    });

    return () => {
      network.destroy();
      networkRef.current = null;
      nodesDsRef.current = null;
      edgesDsRef.current = null;
    };
  }, [visModule]);

  // Compute current node set in vis format.
  const visNodes = useMemo(() => {
    if (!visModule) return [];
    return nodes.map((n) => {
      const collapsed = collapsedIds?.has(n.id) ?? false;
      const directChildren = childrenMap?.get(n.id)?.length ?? 0;
      return buildVisNode(n, collapsed, directChildren);
    });
  }, [nodes, collapsedIds, childrenMap, visModule]);

  const visEdges = useMemo(() => edges.map(buildVisEdge), [edges]);

  // Sync data deltas into the existing DataSets.
  //
  // We NEVER mutate visNodes and we NEVER pin/unpin nodes via `fixed`. Instead
  // we keep existing nodes nearly still through physics config alone: heavy
  // damping + few iterations + minVelocity cutoff. This sidesteps the drag
  // regression that comes with any `fixed` manipulation.
  useEffect(() => {
    const nodesDs = nodesDsRef.current;
    const net = networkRef.current;
    if (!nodesDs || !net) return;

    const existing = new Set<string>(nodesDs.getIds());
    const incomingIds = new Set(visNodes.map((n) => n.id as string));
    const toRemove = [...existing].filter((id) => !incomingIds.has(id));
    const added = visNodes.filter((n) => !existing.has(n.id as string));

    if (toRemove.length) nodesDs.remove(toRemove);
    nodesDs.update(visNodes);

    if (added.length === 0) return;

    // Parent mapping: new node -> existing containment parent.
    const parentMap = new Map<string, string>();
    for (const e of visEdges) {
      const from = e.from as string;
      const to = e.to as string;
      if (existing.has(from) && incomingIds.has(to) && !existing.has(to) && !parentMap.has(to)) {
        parentMap.set(to, from);
      }
    }

    // Seed new nodes. Most children seed close to their parent (18–30 px) so
    // the physics bloom is visible; LearningComponents get a much larger
    // radius pointing AWAY from the current graph centroid so they drop
    // outside the existing visible cluster instead of piling on top of it.
    const siblingCount = new Map<string, number>();
    const siblingIdx = new Map<string, number>();
    for (const n of added) {
      const parentId = parentMap.get(n.id as string);
      if (parentId) siblingCount.set(parentId, (siblingCount.get(parentId) ?? 0) + 1);
    }

    // Centroid of currently-placed (existing) nodes — used to push outlier
    // kinds (LearningComponent) outward.
    const existingArr = [...existing];
    let centroidX = 0;
    let centroidY = 0;
    if (existingArr.length) {
      const poses = net.getPositions(existingArr);
      for (const id of existingArr) {
        centroidX += poses[id]?.x ?? 0;
        centroidY += poses[id]?.y ?? 0;
      }
      centroidX /= existingArr.length;
      centroidY /= existingArr.length;
    }

    const seedUpdates: Array<{ id: string; x: number; y: number }> = [];
    for (const n of added) {
      const id = n.id as string;
      const parentId = parentMap.get(id);
      if (!parentId) continue;
      const pos = net.getPositions([parentId])[parentId];
      if (!pos) continue;
      const siblings = siblingCount.get(parentId) ?? 1;
      const idx = siblingIdx.get(parentId) ?? 0;
      siblingIdx.set(parentId, idx + 1);

      const isOutlier = (n as { labels?: string[] }).labels?.includes('LearningComponent');
      if (isOutlier) {
        // Direction away from the graph centroid through the parent.
        const dx = pos.x - centroidX;
        const dy = pos.y - centroidY;
        const mag = Math.max(1, Math.hypot(dx, dy));
        const outX = dx / mag;
        const outY = dy / mag;
        const radius = 220 + Math.random() * 80;
        // Fan LC siblings perpendicular to the outward ray.
        const spread = ((idx - (siblings - 1) / 2) / Math.max(1, siblings)) * 80;
        seedUpdates.push({
          id,
          x: pos.x + outX * radius + -outY * spread,
          y: pos.y + outY * radius + outX * spread,
        });
      } else {
        const radius = 18 + Math.random() * 12;
        const angle = (idx / siblings) * Math.PI * 2 + Math.random() * 0.3;
        seedUpdates.push({
          id,
          x: pos.x + Math.cos(angle) * radius,
          y: pos.y + Math.sin(angle) * radius,
        });
      }
    }
    if (seedUpdates.length) nodesDs.update(seedUpdates);

    const isFirstLoad = existing.size === 0;
    net.setOptions({
      physics: {
        enabled: true,
        solver: 'forceAtlas2Based',
        forceAtlas2Based: {
          gravitationalConstant: isFirstLoad ? -40 : -30,
          centralGravity: 0.003,
          springLength: 110,
          springConstant: isFirstLoad ? 0.08 : 0.05,
          avoidOverlap: 0.6,
          // Lower damping on incremental adds so the bloom is actually visible.
          // Still high enough that motion dies quickly (well under a second).
          damping: isFirstLoad ? 0.85 : 0.72,
        },
        stabilization: {
          enabled: true,
          iterations: isFirstLoad ? 220 : 45,
          updateInterval: 8,
          fit: isFirstLoad,
        },
        minVelocity: 0.5,
        timestep: 0.45,
      },
    });
    // setOptions alone does NOT kick off a stabilization pass. stabilize() does:
    // it runs the configured iterations and emits stabilizationIterationsDone
    // at the end, which is what drives the visible animation.
    net.stabilize();
    const disable = () => net.setOptions({ physics: { enabled: false } });
    net.once('stabilizationIterationsDone', disable);
    // Belt-and-braces: force physics off after a bounded wall-clock time in
    // case `stabilizationIterationsDone` doesn't fire.
    setTimeout(disable, 1500);
  }, [visNodes, visEdges]);

  useEffect(() => {
    const ds = edgesDsRef.current;
    if (!ds) return;
    const existing: string[] = ds.getIds();
    const next = new Set(visEdges.map((e) => e.id));
    const toRemove = existing.filter((id) => !next.has(id));
    if (toRemove.length) ds.remove(toRemove);
    ds.update(visEdges);
  }, [visEdges]);

  return (
    <div className="graph-stage">
      <div ref={containerRef} className="canvas" />
      {loading && <div className="loading">Loading subgraph…</div>}
    </div>
  );
}
