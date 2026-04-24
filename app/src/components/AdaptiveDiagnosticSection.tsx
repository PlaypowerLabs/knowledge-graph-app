'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  AdaptiveDiagnosticPlan,
  AdaptiveModeId,
  AdaptiveModeMeta,
} from '@/lib/coherenceAdaptive';
import { formatAdaptivePercent } from '@/lib/coherenceAdaptive';

type Props = {
  modes: AdaptiveModeMeta[];
  plan: AdaptiveDiagnosticPlan | null;
  loading?: boolean;
  error?: string | null;
  onSelectStandard: (code: string) => void;
};

export default function AdaptiveDiagnosticSection({
  modes,
  plan,
  loading,
  error,
  onSelectStandard,
}: Props) {
  const defaultMode = modes[0]?.id ?? 'baseline';
  const [activeMode, setActiveMode] = useState<AdaptiveModeId>(defaultMode);

  useEffect(() => {
    setActiveMode(defaultMode);
  }, [defaultMode, plan?.focus_standard_code]);

  const mode = useMemo(
    () => modes.find((item) => item.id === activeMode) ?? modes[0] ?? null,
    [activeMode, modes],
  );
  const candidates = plan && mode ? plan.candidates[mode.id] || [] : [];

  return (
    <section className="diag-plan">
      <div className="diag-plan-head">
        <div>
          <h4>Adaptive Diagnostic</h4>
          <p>
            This view ranks skills the Bayesian diagnostic would consider next. It shows
            skill-level selection logic, not the final question-file order.
          </p>
        </div>
        {plan && (
          <div className="diag-plan-counts">
            <span>{plan.direct_skill_count} direct skills</span>
            <span>{plan.ancestor_standard_count} prerequisite nodes</span>
            <span>{plan.descendant_standard_count} downstream nodes</span>
          </div>
        )}
      </div>

      {loading && <div className="diag-empty">Loading adaptive plans…</div>}
      {error && !loading && <div className="diag-empty">{error}</div>}
      {!loading && !error && !plan && (
        <div className="diag-empty">No adaptive skill-selection plan is available for this standard.</div>
      )}

      {!loading && !error && plan && (
        <>
          <div className="diag-mode-tabs" role="tablist" aria-label="Adaptive diagnostic modes">
            {modes.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === activeMode}
                className={item.id === activeMode ? 'diag-mode-tab active' : 'diag-mode-tab'}
                onClick={() => setActiveMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {mode && (
            <div className="diag-mode-copy">
              <div className="diag-mode-label">{mode.label}</div>
              <p>{mode.description}</p>
            </div>
          )}

          {candidates.length ? (
            <div className="diag-candidates">
              {candidates.map((candidate, index) => (
                <article key={`${activeMode}:${candidate.source_standard_code}:${candidate.skill_id}`} className="diag-card">
                  <div className="diag-card-head">
                    <div>
                      <div className="diag-card-rank">#{index + 1}</div>
                      <div className="diag-card-code">{candidate.skill_code || candidate.skill_id}</div>
                      <div className="diag-card-name">{candidate.skill_name || 'Unnamed skill'}</div>
                    </div>
                    <div className="diag-card-score">
                      <div className="diag-card-score-label">Selection score</div>
                      <div className="diag-card-score-value">{formatAdaptivePercent(candidate.score)}</div>
                      <div className="diag-score-bar">
                        <span style={{ width: `${candidate.score * 100}%` }} />
                      </div>
                    </div>
                  </div>

                  <div className="diag-card-meta">
                    <button
                      type="button"
                      className={`diag-standard-chip ${candidate.relation}`}
                      onClick={() => onSelectStandard(candidate.source_standard_code)}
                    >
                      {candidate.source_standard_code}
                    </button>
                    <span>{labelForRelation(candidate.relation, candidate.distance)}</span>
                    <span>{candidate.question_file_count} files</span>
                    <span>{candidate.num_levels} levels</span>
                    <span>{candidate.question_count} questions</span>
                  </div>

                  <p className="diag-card-copy">{candidate.explanation}</p>

                  <div className="diag-breakdowns">
                    <MetricRow
                      label="Target alignment"
                      value={candidate.score_breakdown.target_alignment}
                    />
                    <MetricRow
                      label="Observability"
                      value={candidate.score_breakdown.observability}
                    />
                    <MetricRow
                      label="Graph support"
                      value={candidate.score_breakdown.graph_support}
                    />
                    <MetricRow
                      label="Cross-grade relevance"
                      value={candidate.score_breakdown.cross_grade_relevance}
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="diag-empty">No ranked skills were available for this mode.</div>
          )}

          {plan.prerequisite_standards.length ? (
            <div className="diag-prereqs">
              <div className="diag-subhead">
                <h5>Highest-Value Prerequisite Standards</h5>
                <span>{plan.prerequisite_standards.length} standards</span>
              </div>
              <div className="diag-prereq-list">
                {plan.prerequisite_standards.map((standard) => (
                  <button
                    key={standard.standard_code}
                    type="button"
                    className="diag-prereq-item"
                    onClick={() => onSelectStandard(standard.standard_code)}
                  >
                    <div className="diag-prereq-code">{standard.standard_code}</div>
                    <div className="diag-prereq-meta">
                      <span>{standard.distance} step{standard.distance === 1 ? '' : 's'} back</span>
                      <span>{standard.skill_count} skills</span>
                      <span>{formatAdaptivePercent(standard.cross_grade_gap)} older-grade gap</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="diag-metric">
      <div className="diag-metric-head">
        <span>{label}</span>
        <span>{formatAdaptivePercent(value)}</span>
      </div>
      <div className="diag-metric-bar">
        <span style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function labelForRelation(relation: 'focus' | 'ancestor' | 'descendant', distance: number) {
  if (relation === 'focus') return 'focus standard';
  if (relation === 'ancestor') {
    return distance === 1 ? 'direct prerequisite' : `${distance} steps up the graph`;
  }
  return distance === 1 ? 'direct downstream check' : `${distance} steps forward`;
}
