'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoherenceGraph, CoherenceNode } from '@/lib/coherence';
import { domainColor, gradeRank, plainifyDescription } from '@/lib/coherence';
import type { DiagnosticCandidateView, DiagnosticStandardStatus } from '@/lib/diagnosticEngine';

type Props = {
  graph: CoherenceGraph;
  currentTargetCode: string | null;
  currentSourceCode: string | null;
  pathCodes: string[];
  changedCodes: string[];
  retainedCodes: string[];
  leaderboard: DiagnosticCandidateView[];
  statusByCode: Record<string, DiagnosticStandardStatus>;
  onSelectNode: (code: string) => void;
};

type EdgeRecord = {
  id: string;
  sourceCode: string;
  targetCode: string;
};

const STATUS_COLORS: Record<DiagnosticStandardStatus, { background: string; text: string }> = {
  mastered: { background: '#ecfdf5', text: '#047857' },
  unmastered: { background: '#fef2f2', text: '#b91c1c' },
  mixed: { background: '#eff6ff', text: '#1d4ed8' },
  unknown: { background: '#ffffff', text: '#374151' },
};
const GRAPH_ANIMATION_MS = 360;

export default function DiagnosticGraphView({
  graph,
  currentTargetCode,
  currentSourceCode,
  pathCodes,
  changedCodes,
  retainedCodes,
  leaderboard,
  statusByCode,
  onSelectNode,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const networkRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodesDsRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgesDsRef = useRef<any>(null);
  const disablePhysicsTimerRef = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [visModule, setVisModule] = useState<any>(null);

  const selectRef = useRef(onSelectNode);
  selectRef.current = onSelectNode;

  useEffect(() => {
    let cancelled = false;
    import('vis-network/standalone').then((module) => {
      if (!cancelled) setVisModule(module);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const graphData = useMemo(() => {
    const selectableNodes = graph.nodes.filter(
      (node) => node.code && (node.level === 'standard' || node.level === 'substandard'),
    );
    const nodesByCode = new Map<string, CoherenceNode>();
    const idToCode = new Map<string, string>();
    for (const node of selectableNodes) {
      if (!node.code) continue;
      nodesByCode.set(node.code, node);
      idToCode.set(node.id, node.code);
    }

    const forward = new Map<string, string[]>();
    const reverse = new Map<string, string[]>();
    const edges: EdgeRecord[] = [];

    for (const edge of graph.edges) {
      if (edge.label !== 'buildsTowards') continue;
      const sourceCode = idToCode.get(edge.source);
      const targetCode = idToCode.get(edge.target);
      if (!sourceCode || !targetCode) continue;
      edges.push({ id: edge.id, sourceCode, targetCode });
      const nextForward = forward.get(sourceCode);
      if (nextForward) nextForward.push(targetCode);
      else forward.set(sourceCode, [targetCode]);
      const nextReverse = reverse.get(targetCode);
      if (nextReverse) nextReverse.push(sourceCode);
      else reverse.set(targetCode, [sourceCode]);
    }

    return { nodesByCode, forward, reverse, edges };
  }, [graph]);

  const visible = useMemo(() => {
    const activeSeedCodes = new Set<string>();
    if (currentTargetCode) activeSeedCodes.add(currentTargetCode);
    if (currentSourceCode) activeSeedCodes.add(currentSourceCode);
    for (const code of pathCodes) activeSeedCodes.add(code);
    for (const code of changedCodes) activeSeedCodes.add(code);
    for (const candidate of leaderboard.slice(0, 6)) {
      activeSeedCodes.add(candidate.target_standard_code);
      activeSeedCodes.add(candidate.source_standard_code);
    }

    const retained = new Set<string>(retainedCodes);
    const scoped = new Set<string>(retained);
    for (const code of activeSeedCodes) {
      scoped.add(code);
      for (const parent of graphData.reverse.get(code) || []) scoped.add(parent);
      for (const child of graphData.forward.get(code) || []) scoped.add(child);
    }

    const nodes = [...scoped]
      .map((code) => graphData.nodesByCode.get(code))
      .filter(Boolean) as CoherenceNode[];

    nodes.sort((a, b) => {
      const aBoost = a.code === currentTargetCode ? -3 : a.code === currentSourceCode ? -2 : 0;
      const bBoost = b.code === currentTargetCode ? -3 : b.code === currentSourceCode ? -2 : 0;
      if (aBoost !== bBoost) return aBoost - bBoost;
      const gradeDiff = gradeRank(a.grade) - gradeRank(b.grade);
      if (gradeDiff !== 0) return gradeDiff;
      return (a.code || '').localeCompare(b.code || '', undefined, { numeric: true });
    });

    const visibleCodes = new Set(nodes.map((node) => node.code!));
    const pathPairs = new Set<string>();
    for (let index = 0; index < pathCodes.length - 1; index += 1) {
      pathPairs.add(`${pathCodes[index]}->${pathCodes[index + 1]}`);
    }

    const edges = graphData.edges.filter(
      (edge) => visibleCodes.has(edge.sourceCode) && visibleCodes.has(edge.targetCode),
    );

    return { nodes, edges, pathPairs, activeSeedCodes, retained };
  }, [
    changedCodes,
    currentSourceCode,
    currentTargetCode,
    graphData.edges,
    graphData.forward,
    graphData.nodesByCode,
    graphData.reverse,
    leaderboard,
    pathCodes,
    retainedCodes,
  ]);

  useEffect(() => {
    if (!visModule || !containerRef.current) return;
    const vis = visModule;
    const nodesDataset = new vis.DataSet([]);
    const edgesDataset = new vis.DataSet([]);
    nodesDsRef.current = nodesDataset;
    edgesDsRef.current = edgesDataset;

    const network = new vis.Network(
      containerRef.current,
      { nodes: nodesDataset, edges: edgesDataset },
      {
        layout: {
          improvedLayout: true,
        },
        physics: {
          enabled: true,
          solver: 'forceAtlas2Based',
          forceAtlas2Based: {
            gravitationalConstant: -55,
            centralGravity: 0.018,
            springLength: 165,
            springConstant: 0.08,
            damping: 0.45,
            avoidOverlap: 0.75,
          },
          stabilization: {
            enabled: true,
            iterations: 120,
            fit: false,
          },
        },
        interaction: {
          hover: true,
          tooltipDelay: 120,
          navigationButtons: true,
          keyboard: true,
          dragNodes: true,
        },
      },
    );

    networkRef.current = network;
    network.once('afterDrawing', () => {
      network.fit({ animation: { duration: 220, easingFunction: 'easeInOutQuad' } });
    });

    network.on('selectNode', (event: { nodes: string[] }) => {
      const code = event.nodes[0];
      if (code) selectRef.current(code);
    });

    return () => {
      if (disablePhysicsTimerRef.current != null) {
        window.clearTimeout(disablePhysicsTimerRef.current);
        disablePhysicsTimerRef.current = null;
      }
      network.destroy();
      networkRef.current = null;
      nodesDsRef.current = null;
      edgesDsRef.current = null;
    };
  }, [visModule]);

  const visNodes = useMemo(
    () =>
      visible.nodes.map((node) => {
        const code = node.code!;
        const isTarget = code === currentTargetCode;
        const isSource = code === currentSourceCode && code !== currentTargetCode;
        const isPath = pathCodes.includes(code);
        const isChanged = changedCodes.includes(code);
        const isRetainedOnly = visible.retained.has(code) && !visible.activeSeedCodes.has(code);
        const status = statusByCode[code] ?? 'unknown';
        const palette = STATUS_COLORS[status];
        const borderColor = isTarget
          ? domainColor(node.domain)
          : isSource
            ? '#2563eb'
            : isPath
              ? '#d97706'
              : isChanged
                ? '#0f766e'
                : domainColor(node.domain);

        return {
          id: code,
          label: code,
          shape: 'box',
          color: {
            background: isTarget
              ? domainColor(node.domain)
              : isSource
                ? '#dbeafe'
                : isRetainedOnly
                  ? '#f8fafc'
                  : palette.background,
            border: borderColor,
            highlight: {
              background: isTarget ? domainColor(node.domain) : '#fff',
              border: borderColor,
            },
          },
          borderWidth: isTarget ? 3 : isSource || isPath ? 2.5 : 2,
          font: {
            size: isTarget ? 15 : 12,
            color: isTarget
              ? '#fff'
              : isSource
                ? '#1d4ed8'
                : isRetainedOnly
                  ? '#64748b'
                  : palette.text,
            face: 'system-ui',
            bold: isTarget || isSource,
          },
          title: buildTooltip(node, {
            isTarget,
            isSource,
            isPath,
            isChanged,
            isRetainedOnly,
            status,
          }),
          shapeProperties: { borderRadius: 6 },
          margin: 10,
        };
      }),
    [
      changedCodes,
      currentSourceCode,
      currentTargetCode,
      pathCodes,
      statusByCode,
      visible.activeSeedCodes,
      visible.nodes,
      visible.retained,
    ],
  );

  const visEdges = useMemo(
    () =>
      visible.edges.map((edge) => {
        const isPath = visible.pathPairs.has(`${edge.sourceCode}->${edge.targetCode}`);
        return {
          id: edge.id,
          from: edge.sourceCode,
          to: edge.targetCode,
          arrows: { to: { enabled: true, scaleFactor: 0.58 } },
          color: { color: isPath ? '#d97706' : '#94a3b8', opacity: isPath ? 0.95 : 0.6 },
          width: isPath ? 2.4 : 1.4,
          smooth: { enabled: true, type: 'cubicBezier', roundness: 0.24 },
        };
      }),
    [visible.edges, visible.pathPairs],
  );

  useEffect(() => {
    const network = networkRef.current;
    const nodesDataset = nodesDsRef.current;
    const edgesDataset = edgesDsRef.current;
    if (!network || !nodesDataset || !edgesDataset) return;

    const incomingNodeIds = new Set(visNodes.map((node) => node.id as string));
    const existingNodeIds = new Set<string>(nodesDataset.getIds());
    const nodesToRemove = [...existingNodeIds].filter((id) => !incomingNodeIds.has(id));
    const addedNodeCount = visNodes.filter((node) => !existingNodeIds.has(node.id as string)).length;
    if (nodesToRemove.length) nodesDataset.remove(nodesToRemove);
    nodesDataset.update(visNodes);

    const incomingEdgeIds = new Set(visEdges.map((edge) => edge.id as string));
    const existingEdgeIds = new Set<string>(edgesDataset.getIds());
    const edgesToRemove = [...existingEdgeIds].filter((id) => !incomingEdgeIds.has(id));
    const addedEdgeCount = visEdges.filter((edge) => !existingEdgeIds.has(edge.id as string)).length;
    if (edgesToRemove.length) edgesDataset.remove(edgesToRemove);
    edgesDataset.update(visEdges);

    const structureChanged =
      addedNodeCount > 0 ||
      nodesToRemove.length > 0 ||
      addedEdgeCount > 0 ||
      edgesToRemove.length > 0;

    if (structureChanged) {
      network.setOptions({
        physics: {
          enabled: true,
          solver: 'forceAtlas2Based',
          forceAtlas2Based: {
            gravitationalConstant: -55,
            centralGravity: 0.018,
            springLength: 165,
            springConstant: 0.08,
            damping: 0.45,
            avoidOverlap: 0.75,
          },
          stabilization: {
            enabled: true,
            iterations: 120,
            fit: false,
          },
        },
      });
      network.stabilize(80);
      network.fit({ animation: { duration: GRAPH_ANIMATION_MS, easingFunction: 'easeInOutQuad' } });

      if (disablePhysicsTimerRef.current != null) {
        window.clearTimeout(disablePhysicsTimerRef.current);
      }
      disablePhysicsTimerRef.current = window.setTimeout(() => {
        network.setOptions({ physics: { enabled: false } });
        disablePhysicsTimerRef.current = null;
      }, GRAPH_ANIMATION_MS + 120);
      return;
    }

    if (currentTargetCode) {
      network.focus(currentTargetCode, {
        scale: 0.95,
        animation: { duration: 240, easingFunction: 'easeInOutQuad' },
      });
    } else {
      network.fit({ animation: { duration: 220, easingFunction: 'easeInOutQuad' } });
    }
  }, [currentTargetCode, visEdges, visNodes]);

  return <div ref={containerRef} className="diag-graph-canvas" />;
}

function buildTooltip(
  node: CoherenceNode,
  flags: {
    isTarget: boolean;
    isSource: boolean;
    isPath: boolean;
    isChanged: boolean;
    isRetainedOnly: boolean;
    status: DiagnosticStandardStatus;
  },
) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    'max-width:360px;font-size:12px;line-height:1.45;font-family:system-ui,-apple-system,sans-serif;color:#222;padding:2px';

  const head = document.createElement('div');
  head.style.fontWeight = '600';
  head.textContent = `${node.code ?? ''}${node.grade ? `  ·  Grade ${node.grade}` : ''}`;
  wrapper.appendChild(head);

  const tags = [
    flags.isTarget ? 'current target' : null,
    flags.isSource ? 'current source' : null,
    flags.isPath ? 'suspected path' : null,
    flags.isChanged ? 'changed last step' : null,
    flags.isRetainedOnly ? 'seen earlier in session' : null,
    flags.status,
  ].filter(Boolean);

  if (tags.length) {
    const meta = document.createElement('div');
    meta.style.marginTop = '4px';
    meta.style.color = '#475569';
    meta.textContent = tags.join(' · ');
    wrapper.appendChild(meta);
  }

  if (node.description) {
    const body = document.createElement('div');
    body.style.marginTop = '6px';
    body.style.whiteSpace = 'pre-wrap';
    const plain = plainifyDescription(node.description);
    body.textContent = plain.length > 320 ? `${plain.slice(0, 320)}…` : plain;
    wrapper.appendChild(body);
  }

  return wrapper;
}
