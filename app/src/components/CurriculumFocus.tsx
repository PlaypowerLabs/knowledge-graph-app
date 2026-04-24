'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type CurriculumFocus as FocusData,
  bandColor,
  courseRank,
  prettyCourse,
} from '@/lib/curriculum';

type Props = {
  data: FocusData;
  onSelectNode: (id: string) => void;
};

// Hierarchical layout by `courseRank`, so prerequisites sit below the focus
// and dependents above. Clipped to direct neighbors for drawer legibility
// (transitive lineage goes in the chip lists).
export default function CurriculumFocus({ data, onSelectNode }: Props) {
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
      const bg = bandColor(n.band);
      return {
        id: n.id,
        label: truncate(n.name ?? '', 38),
        level: courseRank(n.courseCode),
        shape: 'box',
        color: {
          background: isFocus ? bg : '#fff',
          border: bg,
          highlight: { background: bg, border: bg },
        },
        borderWidth: isFocus ? 3 : 2,
        font: {
          size: isFocus ? 13 : 11,
          color: isFocus ? '#fff' : '#111',
          face: 'system-ui',
          bold: isFocus,
        },
        title: buildTooltip(n),
        widthConstraint: { minimum: 120, maximum: 180 },
        shapeProperties: { borderRadius: 4 },
      };
    });

    const visEdges = data.edges
      .filter((e) => directIds.has(e.source) && directIds.has(e.target))
      .map((e) => {
        const targetBand = byId.get(e.target)?.band;
        return {
          id: e.id,
          from: e.source,
          to: e.target,
          arrows: { to: { enabled: true, scaleFactor: 0.6 } },
          color: { color: bandColor(targetBand), opacity: 0.7 },
          smooth: { enabled: true, type: 'cubicBezier', roundness: 0.35 },
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
            direction: 'DU', // prereqs below, dependents above
            sortMethod: 'directed',
            levelSeparation: 120,
            nodeSpacing: 180,
            treeSpacing: 220,
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
      selectRef.current(id);
    });

    return () => {
      net.destroy();
      netRef.current = null;
    };
  }, [visModule, data]);

  return <div ref={containerRef} className="curr-focus-canvas" />;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function buildTooltip(n: {
  name: string | null;
  ordinalName: string | null;
  courseCode: string | null;
}): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'max-width:320px;font-size:12px;line-height:1.45;font-family:system-ui,-apple-system,sans-serif;color:#222;padding:2px';
  const head = document.createElement('div');
  head.style.fontWeight = '600';
  head.textContent = n.name ?? '';
  el.appendChild(head);
  const sub = document.createElement('div');
  sub.style.cssText = 'margin-top:4px;color:#555';
  sub.textContent = `${prettyCourse(n.courseCode)}${n.ordinalName ? ` · ${n.ordinalName}` : ''}`;
  el.appendChild(sub);
  return el;
}
