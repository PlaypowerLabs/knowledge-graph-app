'use client';

import { useMemo } from 'react';
import {
  type CurriculumGraph,
  type CurriculumNode,
  bandColor,
  courseRank,
  prettyCourse,
} from '@/lib/curriculum';

type Props = {
  graph: CurriculumGraph;
  focusId: string | null;
  highlightIds: Set<string>;
  onSelect: (id: string) => void;
};

// Layout: bands as row groups (Elementary / Middle / High), courses as columns,
// units stacked in each cell ordered by `position`.
export default function CurriculumGrid({ graph, focusId, highlightIds, onSelect }: Props) {
  const columns = useMemo(() => {
    const byCourse = new Map<string, CurriculumNode[]>();
    for (const n of graph.nodes) {
      if (!n.courseCode) continue;
      (byCourse.get(n.courseCode) ?? byCourse.set(n.courseCode, []).get(n.courseCode)!).push(n);
    }
    for (const arr of byCourse.values()) arr.sort((a, b) => a.position - b.position);
    return [...byCourse.entries()]
      .sort(([a], [b]) => courseRank(a) - courseRank(b))
      .map(([code, units]) => ({ code, band: units[0].band, units }));
  }, [graph]);

  const groupedByBand = useMemo(() => {
    const out: Record<string, typeof columns> = { Elementary: [], Middle: [], High: [] };
    for (const col of columns) {
      if (col.band && out[col.band]) out[col.band].push(col);
    }
    return out;
  }, [columns]);

  return (
    <div className="curr-grid-wrap">
      {(['Elementary', 'Middle', 'High'] as const).map((band) => {
        const cols = groupedByBand[band];
        if (!cols || cols.length === 0) return null;
        return (
          <section key={band} className="curr-band">
            <header className="curr-band-head" style={{ borderLeftColor: bandColor(band) }}>
              <span className="curr-band-name">{band} School</span>
              <span className="curr-band-count">{cols.length} courses</span>
            </header>
            <div className="curr-columns">
              {cols.map((col) => (
                <CourseColumn
                  key={col.code}
                  courseCode={col.code}
                  units={col.units}
                  focusId={focusId}
                  highlightIds={highlightIds}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CourseColumn({
  courseCode,
  units,
  focusId,
  highlightIds,
  onSelect,
}: {
  courseCode: string;
  units: CurriculumNode[];
  focusId: string | null;
  highlightIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="curr-col">
      <div className="curr-col-head">{prettyCourse(courseCode)}</div>
      <ol className="curr-units">
        {units.map((u) => {
          const isFocus = u.id === focusId;
          const isLineage = highlightIds.has(u.id);
          const cls = [
            'curr-unit',
            isFocus ? 'curr-unit-focus' : '',
            isLineage && !isFocus ? 'curr-unit-lineage' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={u.id}>
              <button
                type="button"
                className={cls}
                title={u.name ?? ''}
                onClick={() => onSelect(u.id)}
              >
                <span className="curr-unit-ord">{u.ordinalName ?? `Unit ${u.position + 1}`}</span>
                <span className="curr-unit-name">{u.name}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
