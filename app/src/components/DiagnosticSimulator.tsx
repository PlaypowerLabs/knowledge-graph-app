'use client';

import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RotateCcw, Undo2 } from 'lucide-react';
import CoherenceGrid from '@/components/CoherenceGrid';
import {
  type CoherenceGraph,
  domainName,
  plainifyDescription,
} from '@/lib/coherence';
import type { AdaptiveDiagnosticIndex } from '@/lib/coherenceAdaptive';
import { formatAdaptivePercent } from '@/lib/coherenceAdaptive';
import {
  createDiagnosticModel,
  diagnosticOutcomeOptions,
  type DiagnosticCandidateView,
  type DiagnosticOutcome,
  simulateDiagnosticSession,
} from '@/lib/diagnosticSimulator';

type Props = {
  graph: CoherenceGraph;
  adaptive: AdaptiveDiagnosticIndex;
  initialGrade?: string | null;
};

export default function DiagnosticSimulator({ graph, adaptive, initialGrade }: Props) {
  const model = useMemo(() => createDiagnosticModel(graph, adaptive), [graph, adaptive]);
  const defaultGrade = useMemo(() => {
    if (initialGrade && model.grades.includes(initialGrade)) return initialGrade;
    return model.grades[0] ?? '';
  }, [initialGrade, model.grades]);

  const [draftGrade, setDraftGrade] = useState(defaultGrade);
  const [sessionGrade, setSessionGrade] = useState(defaultGrade);
  const [events, setEvents] = useState<DiagnosticOutcome[]>([]);
  const [inspectedCode, setInspectedCode] = useState<string | null>(null);

  useEffect(() => {
    setDraftGrade(defaultGrade);
    setSessionGrade(defaultGrade);
    setEvents([]);
  }, [defaultGrade]);

  const session = useMemo(() => {
    if (!sessionGrade) return null;
    return simulateDiagnosticSession(model, sessionGrade, events);
  }, [events, model, sessionGrade]);

  useEffect(() => {
    if (!session?.current_target_standard_code) return;
    if (!inspectedCode) setInspectedCode(session.current_target_standard_code);
  }, [inspectedCode, session?.current_target_standard_code]);

  const inspectedNode = useMemo(() => {
    const code = inspectedCode || session?.current_target_standard_code;
    return code ? model.nodesByCode.get(code) ?? null : null;
  }, [inspectedCode, model.nodesByCode, session?.current_target_standard_code]);

  const pathCodes = useMemo(
    () => new Set(session?.current_path_codes || []),
    [session?.current_path_codes],
  );
  const changedCodes = useMemo(
    () => new Set(session?.changed_codes || []),
    [session?.changed_codes],
  );
  const highlightUuids = useMemo(() => new Set<string>(), []);
  const modeMeta = useMemo(
    () => new Map(adaptive.modes.map((mode) => [mode.id, mode])),
    [adaptive.modes],
  );

  const handleStart = useCallback(() => {
    if (!draftGrade) return;
    startTransition(() => {
      setSessionGrade(draftGrade);
      setEvents([]);
      setInspectedCode(null);
    });
    syncGradeUrl(draftGrade);
  }, [draftGrade]);

  const handleReset = useCallback(() => {
    startTransition(() => {
      setEvents([]);
      setInspectedCode(null);
    });
  }, []);

  const handleUndo = useCallback(() => {
    startTransition(() => {
      setEvents((prev) => prev.slice(0, -1));
      setInspectedCode(null);
    });
  }, []);

  const handleReplayFrom = useCallback((step: number) => {
    startTransition(() => {
      setEvents((prev) => prev.slice(0, step));
      setInspectedCode(null);
    });
  }, []);

  const handleOutcome = useCallback((outcome: DiagnosticOutcome) => {
    startTransition(() => {
      setEvents((prev) => [...prev, outcome]);
      setInspectedCode(null);
    });
  }, []);

  const currentCandidate = session?.current_recommendation ?? null;

  return (
    <>
      <div className="toolbar">
        <span className="title">Graph-Adaptive Diagnostic Simulator · CCSS-M</span>

        <label>
          Grade
          <select value={draftGrade} onChange={(e) => setDraftGrade(e.target.value)}>
            {model.grades.map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </label>

        <button type="button" onClick={handleStart} disabled={!draftGrade}>
          Start session
        </button>
        <button type="button" onClick={handleReset} disabled={!session || events.length === 0}>
          <RotateCcw size={14} />
          Reset
        </button>
        <button type="button" onClick={handleUndo} disabled={!events.length}>
          <Undo2 size={14} />
          Undo
        </button>

        <div className="stats">
          {session ? (
            <>
              Step {session.summary.current_step} · {session.summary.grade_standard_count} grade{' '}
              {session.grade} standards · {session.summary.mastered_skill_count} mastered skills ·{' '}
              {session.summary.unmastered_skill_count} weak skills ·{' '}
              {session.summary.unknown_skill_count} unresolved skills in play
            </>
          ) : (
            'Loading simulator…'
          )}
          <Link
            href="/coherence"
            style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}
          >
            Coherence Map →
          </Link>
          <Link href="/" style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}>
            ← KG Viewer
          </Link>
        </div>
      </div>

      <div className="diag-sim-shell">
        <section className="diag-sim-panel diag-sim-graph">
          <div className="diag-panel-head">
            <div>
              <h3>Standards Graph</h3>
              <p>
                The simulator starts from Grade {sessionGrade} and chooses skills across the full
                grade-level pool. Older standards only surface when the current evidence points
                toward a prerequisite gap.
              </p>
            </div>
          </div>

          <div className="diag-legend">
            <span className="diag-legend-item current">Current target</span>
            <span className="diag-legend-item path">Suspected path</span>
            <span className="diag-legend-item changed">Changed last step</span>
            <span className="diag-legend-item mastered">Mastered</span>
            <span className="diag-legend-item unmastered">Weak</span>
            <span className="diag-legend-item mixed">Mixed</span>
          </div>

          <div className="diag-graph-scroll">
            <CoherenceGrid
              graph={graph}
              focusCode={session?.current_target_standard_code ?? null}
              highlightUuids={highlightUuids}
              onSelect={setInspectedCode}
              statusByCode={session?.status_by_code}
              pathCodes={pathCodes}
              changedCodes={changedCodes}
            />
          </div>

          {inspectedNode && (
            <div className="diag-inspector">
              <div className="diag-inspector-head">
                <div>
                  <div className="diag-kicker">Inspected standard</div>
                  <div className="diag-standard-line">
                    <strong>{inspectedNode.code}</strong>
                    <span>
                      Grade {inspectedNode.grade} · {domainName(inspectedNode.domain)}
                    </span>
                  </div>
                </div>
                {session?.current_target_standard_code &&
                  inspectedNode.code !== session.current_target_standard_code && (
                    <button type="button" onClick={() => setInspectedCode(null)}>
                      Follow simulator target
                    </button>
                  )}
              </div>
              {inspectedNode.description && (
                <p>{plainifyDescription(inspectedNode.description)}</p>
              )}
            </div>
          )}
        </section>

        <section className="diag-sim-panel diag-sim-current">
          <div className="diag-panel-head">
            <div>
              <h3>Current Skill Probe</h3>
              <p>This is the skill the engine would present now based on the current session state.</p>
            </div>
          </div>

          {currentCandidate ? (
            <CurrentProbeCard
              candidate={currentCandidate}
              hypothesis={session?.current_hypothesis || null}
              modeLabel={modeMeta.get(currentCandidate.mode)?.label ?? currentCandidate.mode}
              onOutcome={handleOutcome}
              branchPreview={session?.branch_preview || []}
            />
          ) : (
            <div className="diag-empty">
              No current skill is available for this grade. That usually means the current data
              slice has no adaptive candidates to show.
            </div>
          )}
        </section>

        <section className="diag-sim-panel diag-sim-why">
          <div className="diag-panel-head">
            <div>
              <h3>Why This Skill Won</h3>
              <p>
                The leaderboard below shows the strongest competing skills and what pushed the
                current winner above them.
              </p>
            </div>
          </div>

          {currentCandidate ? (
            <>
              <div className="diag-why-card">
                <div className="diag-subhead">
                  <h5>Current decision factors</h5>
                  <span>{formatAdaptivePercent(currentCandidate.selection_score)} selection score</span>
                </div>
                <MetricRow label="Target need" value={currentCandidate.influences.target_need} />
                <MetricRow
                  label="Skill prior"
                  value={currentCandidate.influences.artifact_priority}
                />
                <MetricRow
                  label="Uncertainty gain"
                  value={currentCandidate.influences.uncertainty_gain}
                />
                <MetricRow
                  label="Follow-up pressure"
                  value={currentCandidate.influences.followup_pressure}
                />
                <MetricRow
                  label="Source signal"
                  value={currentCandidate.influences.source_signal}
                />
              </div>

              <div className="diag-why-card">
                <div className="diag-subhead">
                  <h5>Influence summary</h5>
                  <span>{currentCandidate.reasons.length} active factors</span>
                </div>
                <ul className="diag-reasons">
                  {currentCandidate.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}

          <div className="diag-why-card">
            <div className="diag-subhead">
              <h5>Top candidates</h5>
              <span>{session?.leaderboard.length ?? 0} shown</span>
            </div>
            <div className="diag-leaderboard">
              {(session?.leaderboard || []).map((candidate, index) => (
                <CandidateCard
                  key={`${candidate.target_standard_code}:${candidate.source_standard_code}:${candidate.skill_id}`}
                  candidate={candidate}
                  index={index}
                  current={
                    currentCandidate
                      ? candidate.target_standard_code === currentCandidate.target_standard_code &&
                        candidate.source_standard_code === currentCandidate.source_standard_code &&
                        candidate.skill_id === currentCandidate.skill_id
                      : false
                  }
                  modeLabel={modeMeta.get(candidate.mode)?.label ?? candidate.mode}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="diag-sim-panel diag-sim-history">
          <div className="diag-panel-head">
            <div>
              <h3>Session Timeline</h3>
              <p>
                Each row is one simulated learner intervention. Click a row to restore the
                simulator to that exact point and try a different path.
              </p>
            </div>
          </div>

          {session?.history.length ? (
            <div className="diag-history-list">
              {session.history.map((entry) => (
                <button
                  key={entry.step}
                  type="button"
                  className="diag-history-item"
                  onClick={() => handleReplayFrom(entry.step)}
                >
                  <div className="diag-history-top">
                    <div className="diag-history-step">Step {entry.step}</div>
                    <div className={`diag-outcome-tag ${entry.outcome}`}>{entry.outcome_label}</div>
                  </div>
                  <div className="diag-history-main">
                    <strong>{entry.candidate.skill_code || entry.candidate.skill_id}</strong>
                    <span>
                      {entry.candidate.target_standard_code} via {entry.candidate.source_standard_code}
                    </span>
                  </div>
                  <p>{entry.summary}</p>
                  <div className="diag-history-meta">
                    {entry.changed_codes.map((code) => (
                      <span key={code}>{code}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="diag-empty">
              No simulated answers yet. Pick a Grade, start the session, then mark the current
              skill as correct or incorrect to watch the algorithm move.
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function CurrentProbeCard({
  candidate,
  hypothesis,
  modeLabel,
  onOutcome,
  branchPreview,
}: {
  candidate: DiagnosticCandidateView;
  hypothesis: string | null;
  modeLabel: string;
  onOutcome: (outcome: DiagnosticOutcome) => void;
  branchPreview: ReturnType<typeof simulateDiagnosticSession>['branch_preview'];
}) {
  return (
    <div className="diag-current-card">
      <div className="diag-current-top">
        <div>
          <div className="diag-kicker">{modeLabel}</div>
          <div className="diag-current-code">{candidate.skill_code || candidate.skill_id}</div>
          <div className="diag-current-name">{candidate.skill_name || 'Unnamed skill'}</div>
        </div>
        <div className="diag-current-score">
          <span>Selection score</span>
          <strong>{formatAdaptivePercent(candidate.selection_score)}</strong>
        </div>
      </div>

      <div className="diag-current-meta">
        <span>Target {candidate.target_standard_code}</span>
        <span>Source {candidate.source_standard_code}</span>
        <span>{labelForRelation(candidate.relation, candidate.distance)}</span>
        <span>{candidate.question_file_count} files</span>
        <span>{candidate.num_levels} levels</span>
      </div>

      <p className="diag-current-copy">{candidate.explanation}</p>
      {hypothesis && <p className="diag-current-hypothesis">{hypothesis}</p>}

      <div className="diag-action-grid">
        {diagnosticOutcomeOptions().map((option) => (
          <button
            key={option.id}
            type="button"
            className={`diag-action ${option.id}`}
            onClick={() => onOutcome(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="diag-branch-block">
        <div className="diag-subhead">
          <h5>Branch preview</h5>
          <span>What the engine would likely do next</span>
        </div>
        <div className="diag-branch-grid">
          {branchPreview.map((branch) => (
            <div key={branch.outcome} className="diag-branch-card">
              <div className={`diag-outcome-tag ${branch.outcome}`}>{branch.label}</div>
              <div className="diag-branch-list">
                {branch.skills.map((skill) => (
                  <div key={`${branch.outcome}:${skill.target_standard_code}:${skill.skill_id}`}>
                    <strong>{skill.skill_code || skill.skill_id}</strong>
                    <span>
                      {skill.target_standard_code} via {skill.source_standard_code}
                    </span>
                  </div>
                ))}
                {!branch.skills.length && <span>No next skill available.</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  index,
  current,
  modeLabel,
}: {
  candidate: DiagnosticCandidateView;
  index: number;
  current: boolean;
  modeLabel: string;
}) {
  return (
    <article className={current ? 'diag-card diag-card-current' : 'diag-card'}>
      <div className="diag-card-head">
        <div>
          <div className="diag-card-rank">#{index + 1}</div>
          <div className="diag-card-code">{candidate.skill_code || candidate.skill_id}</div>
          <div className="diag-card-name">{candidate.skill_name || 'Unnamed skill'}</div>
        </div>
        <div className="diag-card-score">
          <div className="diag-card-score-label">{modeLabel}</div>
          <div className="diag-card-score-value">
            {formatAdaptivePercent(candidate.selection_score)}
          </div>
          <div className="diag-score-bar">
            <span style={{ width: `${candidate.selection_score * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="diag-card-meta">
        <span className={`diag-standard-chip ${candidate.relation}`}>
          {candidate.target_standard_code}
        </span>
        <span>{candidate.source_standard_code}</span>
        <span>{labelForRelation(candidate.relation, candidate.distance)}</span>
      </div>

      <p className="diag-card-copy">{candidate.reasons[0] || candidate.explanation}</p>
    </article>
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
  if (relation === 'focus') return 'direct measure';
  if (relation === 'ancestor') {
    return distance === 1 ? 'direct prerequisite' : `${distance} steps back`;
  }
  return distance === 1 ? 'direct downstream check' : `${distance} steps forward`;
}

function syncGradeUrl(grade: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (grade) url.searchParams.set('grade', grade);
  else url.searchParams.delete('grade');
  window.history.replaceState(null, '', url.toString());
}
