'use client';

import { useMemo } from 'react';
import {
  type CoherenceGraph,
  type CoherenceNode,
  GRADE_ORDER,
  bucketByGradeCluster,
  domainColor,
  domainName,
} from '@/lib/coherence';

type Props = {
  graph: CoherenceGraph;
  focusCode: string | null;
  // UUIDs to softly highlight (lineage of the focused standard).
  highlightUuids: Set<string>;
  onSelect: (code: string) => void;
};

// Canonical SAP-style grid: grades as rows (K → HS), domains as columns.
// Each cell shows the clusters for that (grade, domain) and the standards
// in each cluster as clickable chips.
export default function CoherenceGrid({ graph, focusCode, highlightUuids, onSelect }: Props) {
  const buckets = useMemo(() => bucketByGradeCluster(graph.nodes), [graph]);

  // Order domains as they appear in the data, with K-8 core domains first
  // (sorted alphabetically) and HS conceptual categories after. MP goes last.
  const domainsOrdered = useMemo(() => {
    const seen = new Set<string>();
    const k8: string[] = [];
    const hs: string[] = [];
    const mp: string[] = [];
    for (const n of graph.nodes) {
      if (!n.domain || seen.has(n.domain)) continue;
      seen.add(n.domain);
      if (n.domain === 'MP') mp.push(n.domain);
      else if (n.domain.includes('-')) hs.push(n.domain);
      else k8.push(n.domain);
    }
    k8.sort();
    hs.sort();
    return [...k8, ...hs, ...mp];
  }, [graph]);

  const grades = useMemo(
    () => GRADE_ORDER.filter((g) => buckets.has(g)),
    [buckets],
  );

  return (
    <div className="coh-grid-wrap">
      <table className="coh-grid">
        <thead>
          <tr>
            <th className="coh-corner">Grade ↓ / Domain →</th>
            {domainsOrdered.map((d) => (
              <th key={d} className="coh-dom-head" title={domainName(d)}>
                <span
                  className="coh-dom-swatch"
                  style={{ background: domainColor(d) }}
                />
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grades.map((g) => {
            const byCluster = buckets.get(g) || new Map();
            return (
              <tr key={g}>
                <th className="coh-grade-head">{g}</th>
                {domainsOrdered.map((d) => (
                  <td key={d} className="coh-cell">
                    <ClusterColumn
                      grade={g}
                      domain={d}
                      byCluster={byCluster}
                      focusCode={focusCode}
                      highlightUuids={highlightUuids}
                      onSelect={onSelect}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClusterColumn({
  grade,
  domain,
  byCluster,
  focusCode,
  highlightUuids,
  onSelect,
}: {
  grade: string;
  domain: string;
  byCluster: Map<string, CoherenceNode[]>;
  focusCode: string | null;
  highlightUuids: Set<string>;
  onSelect: (code: string) => void;
}) {
  // Find the clusters that fall under this (grade, domain) pair. A cluster
  // like "3.NF.A" belongs in the (3, NF) cell; HS clusters like "HSA-REI.B"
  // belong in (HS, A-REI). We match by the first standard's domain.
  const clusters: Array<{ cluster: string; standards: CoherenceNode[] }> = [];
  for (const [cluster, standards] of byCluster) {
    if (standards[0]?.domain === domain) clusters.push({ cluster, standards });
  }
  if (clusters.length === 0) return <span className="coh-empty">—</span>;
  clusters.sort((a, b) => a.cluster.localeCompare(b.cluster, undefined, { numeric: true }));

  return (
    <div className="coh-clusters">
      {clusters.map(({ cluster, standards }) => (
        <div key={cluster} className="coh-cluster">
          <div className="coh-cluster-code" style={{ color: domainColor(domain) }}>
            {cluster.replace(`${grade}.`, '').replace(`HS${domain}.`, '')}
          </div>
          <div className="coh-chips">
            {standards.map((s) => {
              const code = s.code!;
              const isFocus = code === focusCode;
              const isLineage = s.caseIdentifierUUID
                ? highlightUuids.has(s.caseIdentifierUUID)
                : false;
              const cls = [
                'coh-chip',
                isFocus ? 'coh-chip-focus' : '',
                isLineage && !isFocus ? 'coh-chip-lineage' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={s.id}
                  type="button"
                  className={cls}
                  title={s.description?.slice(0, 240) ?? code}
                  onClick={() => onSelect(code)}
                  style={
                    isFocus
                      ? { background: domainColor(domain), color: '#fff', borderColor: domainColor(domain) }
                      : undefined
                  }
                >
                  {code.split('.').slice(-2).join('.')}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
