'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type CoherenceFocus as FocusData,
  domainColor,
  gradeRank,
  plainifyDescription,
} from '@/lib/coherence';

type Props = {
  data: FocusData;
  onSelectNode: (code: string) => void;
};

// vis-network hierarchical layout lays out nodes on a "level" axis. We use the
// grade rank as the level so that prerequisites render below their targets
// (progression reads bottom → top).
export default function CoherenceFocus({ data, onSelectNode }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const netRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [visModule, setVisModule] = useState<any>(null);

  const selectRef = useRef(onSelectNode);
  selectRef.current = onSelectNode;

  useEffect(() => {
    let cancelled = false;
    import('vis-network/standalone').then((m) => {
      if (!cancelled) setVisModule(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!visModule || !containerRef.current) return;
    const vis = visModule;

    // The precomputed focus file includes the full transitive closure. Rendering
    // all of it in a 320px drawer blows past what vis-network can lay out
    // legibly (3.NF.A.1 alone reaches 200+ HS descendants). Clip the in-drawer
    // graph to direct neighbors — one hop each way — and rely on the lineage
    // chip lists for deeper traversal.
    const focusId = data.focus.id;
    const directIds = new Set<string>([focusId]);
    for (const e of data.edges) {
      if (e.source === focusId) directIds.add(e.target);
      if (e.target === focusId) directIds.add(e.source);
    }
    const inScope = [...data.ancestors, ...data.descendants].filter((n) =>
      directIds.has(n.id),
    );
    const all = [data.focus, ...inScope];
    const byId = new Map(all.map((n) => [n.id, n]));

    const visNodes = all.map((n) => {
      const isFocus = n.id === data.focus.id;
      const bg = domainColor(n.domain);
      return {
        id: n.id,
        label: n.code || n.id.slice(0, 8),
        level: gradeRank(n.grade),
        shape: 'box',
        color: {
          background: isFocus ? bg : '#fff',
          border: bg,
          highlight: { background: bg, border: bg },
        },
        borderWidth: isFocus ? 3 : 2,
        font: {
          size: isFocus ? 14 : 12,
          color: isFocus ? '#fff' : '#111',
          face: 'system-ui',
          bold: isFocus,
        },
        title: buildTooltip(n),
        widthConstraint: { minimum: 64 },
        shapeProperties: { borderRadius: 4 },
      };
    });

    const visEdges = data.edges
      .filter((e) => directIds.has(e.source) && directIds.has(e.target))
      .map((e) => {
      const sg = byId.get(e.source)?.grade;
      const tg = byId.get(e.target)?.grade;
      // Color the edge by the target's domain for visual coherence with the grid.
      const color = domainColor(byId.get(e.target)?.domain);
      return {
        id: e.id,
        from: e.source,
        to: e.target,
        arrows: { to: { enabled: true, scaleFactor: 0.6 } },
        color: { color, opacity: 0.7 },
        // Smooth edges between non-adjacent grades so arrows don't overlap.
        smooth:
          sg && tg && Math.abs(gradeRank(sg) - gradeRank(tg)) > 1
            ? { enabled: true, type: 'cubicBezier', roundness: 0.35 }
            : false,
        width: 1.6,
      };
    });

    const nodesDs = new vis.DataSet(visNodes);
    const edgesDs = new vis.DataSet(visEdges);

    const net = new vis.Network(
      containerRef.current,
      { nodes: nodesDs, edges: edgesDs },
      {
        layout: {
          hierarchical: {
            enabled: true,
            direction: 'DU', // prerequisites below (low grade), subsequents above
            sortMethod: 'directed',
            levelSeparation: 110,
            nodeSpacing: 140,
            treeSpacing: 180,
            blockShifting: true,
            edgeMinimization: true,
          },
        },
        physics: { enabled: false },
        interaction: {
          hover: true,
          tooltipDelay: 140,
          navigationButtons: true,
          keyboard: true,
          dragNodes: false,
        },
      },
    );
    netRef.current = net;

    net.on('selectNode', (ev: { nodes: string[] }) => {
      const id = ev.nodes[0];
      if (!id) return;
      const n = byId.get(id);
      if (n?.code) selectRef.current(n.code);
    });

    return () => {
      net.destroy();
      netRef.current = null;
    };
  }, [visModule, data]);

  return <div ref={containerRef} className="coh-focus-canvas" />;
}

function buildTooltip(n: {
  code: string | null;
  grade: string | null;
  description: string | null;
}): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'max-width:360px;font-size:12px;line-height:1.45;font-family:system-ui,-apple-system,sans-serif;color:#222;padding:2px';
  const head = document.createElement('div');
  head.style.fontWeight = '600';
  head.textContent = `${n.code ?? ''}${n.grade ? `  ·  Grade ${n.grade}` : ''}`;
  el.appendChild(head);
  if (n.description) {
    const body = document.createElement('div');
    body.style.marginTop = '6px';
    body.style.whiteSpace = 'pre-wrap';
    const plain = plainifyDescription(n.description);
    body.textContent = plain.length > 320 ? plain.slice(0, 320) + '…' : plain;
    el.appendChild(body);
  }
  return el;
}
