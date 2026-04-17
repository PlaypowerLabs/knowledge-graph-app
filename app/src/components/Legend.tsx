'use client';

import { LABEL_COLORS, EDGE_COLORS } from './GraphViewer';

// Extra hints describing the shape / subtype for each display kind.
const NODE_HINTS: Record<string, { shape: string; hint?: string }> = {
  StandardsFramework: { shape: 'star', hint: 'framework root (one per state + subject)' },
  'Standard Grouping': { shape: 'square', hint: 'Domain / Cluster / Strand' },
  Standard: { shape: 'dot', hint: 'individual standard (leaf)' },
  LearningComponent: { shape: 'dot', hint: 'atomic decomposed skill' },
  Course: { shape: 'diamond', hint: 'curriculum root' },
  LessonGrouping: { shape: 'triangle', hint: 'unit / section' },
  Lesson: { shape: 'dot' },
  Activity: { shape: 'dot' },
  Assessment: { shape: 'dot' },
};

function Swatch({ color, shape }: { color: string; shape: string }) {
  const base: React.CSSProperties = {
    display: 'inline-block',
    width: 12,
    height: 12,
    background: color,
    marginRight: 6,
    flexShrink: 0,
  };
  if (shape === 'square') return <span style={{ ...base, borderRadius: 2 }} />;
  if (shape === 'diamond') return <span style={{ ...base, transform: 'rotate(45deg)', borderRadius: 2 }} />;
  if (shape === 'star')
    return (
      <span
        style={{
          ...base,
          clipPath:
            'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
        }}
      />
    );
  if (shape === 'triangle')
    return (
      <span
        style={{ ...base, clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }}
      />
    );
  return <span style={{ ...base, borderRadius: '50%' }} />;
}

export default function Legend() {
  return (
    <div className="legend">
      <h3>Nodes</h3>
      {Object.entries(LABEL_COLORS).map(([k, v]) => {
        const hint = NODE_HINTS[k];
        return (
          <div key={k} className="row" style={{ alignItems: 'flex-start' }}>
            <Swatch color={v} shape={hint?.shape ?? 'dot'} />
            <span>
              <div style={{ fontWeight: 500 }}>{k}</div>
              {hint?.hint && <div style={{ color: '#777', fontSize: 10.5 }}>{hint.hint}</div>}
            </span>
          </div>
        );
      })}
      <h3>Edges</h3>
      {Object.entries(EDGE_COLORS).map(([k, v]) => (
        <div key={k} className="row">
          <span className="sw bar" style={{ background: v }} />
          {k}
        </div>
      ))}
    </div>
  );
}
