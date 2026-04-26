'use client';

import { startTransition, useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { CircleHelp, Download, ExternalLink, RotateCcw, Undo2 } from 'lucide-react';
import DiagnosticGraphView from '@/components/DiagnosticGraphView';
import DockableDiagnosticShell, {
  type DiagnosticWorkbenchLayout,
  type DiagnosticWorkbenchTab,
} from '@/components/DockableDiagnosticShell';
import DiagnosticQuestionSurface from '@/components/DiagnosticQuestionSurface';
import {
  type CoherenceGraph,
  domainColor,
  domainName,
  plainifyDescription,
} from '@/lib/coherence';
import type { AdaptiveDiagnosticIndex } from '@/lib/coherenceAdaptive';
import { formatAdaptivePercent } from '@/lib/coherenceAdaptive';
import {
  buildIxlViewerUrl,
  buildIxlQuestionUrl,
  findIxlStandard,
  findIxlSkill,
  formatIxlLevelMeta,
  type CoherenceIxlIndex,
  type CoherenceIxlStandard,
} from '@/lib/coherenceIxl';
import { selectCurrentDiagnosticLevel, sortIxlLevels } from '@/lib/diagnosticQuestionSelection';
import {
  createDiagnosticModel,
  type DiagnosticBranchPreview,
  diagnosticOutcomeOptions,
  type DiagnosticCandidateView,
  type DiagnosticOutcome,
  simulateDiagnosticSession,
} from '@/lib/diagnosticEngine';

type Props = {
  graph: CoherenceGraph;
  adaptive: AdaptiveDiagnosticIndex;
  ixl: CoherenceIxlIndex;
  initialGrade?: string | null;
};

type DomainMasterySummary = {
  domain: string;
  label: string;
  standardCount: number;
  mastery: number;
  confidence: number;
  evidenceCount: number;
  masteredCount: number;
  weakCount: number;
  unknownCount: number;
  pressure: number;
  band: 'below' | 'on' | 'above' | 'unknown';
};

const DOMAIN_BAND_LABEL: Record<DomainMasterySummary['band'], string> = {
  unknown: '—',
  below: 'Below',
  on: 'On track',
  above: 'Above',
};

// Map engine band → existing CSS class name (kept for backward compatibility
// with the styles in globals.css).
const DOMAIN_BAND_CLASS: Record<DomainMasterySummary['band'], string> = {
  unknown: 'inconclusive',
  below: 'below',
  on: 'on-track',
  above: 'above',
};

const DIAGNOSTIC_WORKBENCH_DEFAULT: DiagnosticWorkbenchLayout = {
  root: {
    type: 'split',
    id: 'root',
    direction: 'row',
    ratio: 0.62,
    first: {
      type: 'pane',
      id: 'pane-question',
      tabs: ['question'],
      activeTabId: 'question',
    },
    second: {
      type: 'split',
      id: 'root-right',
      direction: 'column',
      ratio: 0.72,
      first: {
        type: 'pane',
        id: 'pane-work',
        tabs: ['current', 'why', 'graph'],
        activeTabId: 'current',
      },
      second: {
        type: 'pane',
        id: 'pane-history',
        tabs: ['history'],
        activeTabId: 'history',
      },
    },
  },
};

export default function DiagnosticSimulator({ graph, adaptive, ixl, initialGrade }: Props) {
  const model = useMemo(() => createDiagnosticModel(graph, adaptive), [graph, adaptive]);
  const defaultGrade = useMemo(() => {
    if (initialGrade && model.grades.includes(initialGrade)) return initialGrade;
    return model.grades[0] ?? '';
  }, [initialGrade, model.grades]);

  const [draftGrade, setDraftGrade] = useState(defaultGrade);
  const [sessionGrade, setSessionGrade] = useState(defaultGrade);
  const [events, setEvents] = useState<DiagnosticOutcome[]>([]);
  const [inspectedCode, setInspectedCode] = useState<string | null>(null);

  const session = useMemo(() => {
    if (!sessionGrade) return null;
    return simulateDiagnosticSession(model, sessionGrade, events);
  }, [events, model, sessionGrade]);

  const inspectedNode = useMemo(() => {
    const code = inspectedCode || session?.current_target_standard_code;
    return code ? model.nodesByCode.get(code) ?? null : null;
  }, [inspectedCode, model.nodesByCode, session?.current_target_standard_code]);
  const inspectedIxl = useMemo(
    () => findIxlStandard(ixl, inspectedNode?.code),
    [inspectedNode, ixl],
  );
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

  const handleExportTimeline = useCallback(() => {
    if (!session) return;
    const payload = {
      grade: session.grade,
      exported_at: new Date().toISOString(),
      events,
      history: session.history,
      summary: session.summary,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diagnostic-session-grade-${session.grade}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [events, session]);

  const currentCandidate = session?.current_recommendation ?? null;
  const currentIxlSkill = useMemo(
    () => findIxlSkill(ixl, currentCandidate?.source_standard_code, currentCandidate?.skill_id),
    [currentCandidate?.skill_id, currentCandidate?.source_standard_code, ixl],
  );
  const currentQuestionLevel = useMemo(() => {
    if (!currentIxlSkill?.levels.length || !currentCandidate) return null;
    return selectCurrentDiagnosticLevel(
      currentIxlSkill,
      currentCandidate,
      session?.skill_state_by_key,
    );
  }, [currentCandidate, currentIxlSkill, session?.skill_state_by_key]);
  const currentViewerUrl = useMemo(
    () => (currentQuestionLevel ? buildIxlViewerUrl(currentQuestionLevel) : null),
    [currentQuestionLevel],
  );
  const domainMastery = useMemo<DomainMasterySummary[]>(() => {
    if (!session) return [];

    // Aggregate per-standard signals that the engine doesn't surface at the
    // domain level: pressure (attention / prereq / recovery) and counts of
    // standards by mastery status. Mastery and confidence themselves come from
    // the engine's domain-level posterior (session.domain_mastery), which
    // correctly converges as items accumulate — averaging per-standard values
    // would drag toward 0.5 for every untouched standard in the domain.
    const perDomainExtras = new Map<
      string,
      {
        masteredCount: number;
        weakCount: number;
        unknownCount: number;
        pressureTotal: number;
        pressureSamples: number;
      }
    >();

    for (const code of model.standardsByGrade.get(session.grade) || []) {
      const node = model.nodesByCode.get(code);
      const domain = node?.domain || 'Unknown';
      const state = session.standard_state_by_code[code];
      const status = session.status_by_code[code] || 'unknown';
      const row =
        perDomainExtras.get(domain) ||
        {
          masteredCount: 0,
          weakCount: 0,
          unknownCount: 0,
          pressureTotal: 0,
          pressureSamples: 0,
        };

      row.pressureTotal += Math.max(
        state?.attention ?? 0,
        state?.prerequisitePressure ?? 0,
        state?.recoveryPressure ?? 0,
      );
      row.pressureSamples += 1;
      if (status === 'mastered') row.masteredCount += 1;
      else if (status === 'unmastered') row.weakCount += 1;
      else if (status === 'unknown') row.unknownCount += 1;

      perDomainExtras.set(domain, row);
    }

    return session.domain_mastery
      .map((snap) => {
        const extras = perDomainExtras.get(snap.domain);
        return {
          domain: snap.domain,
          label: domainName(snap.domain),
          standardCount: snap.standard_count,
          mastery: snap.mastery,
          confidence: snap.confidence,
          evidenceCount: snap.evidence_count,
          masteredCount: extras?.masteredCount ?? 0,
          weakCount: extras?.weakCount ?? 0,
          unknownCount: extras?.unknownCount ?? 0,
          pressure: extras && extras.pressureSamples
            ? extras.pressureTotal / extras.pressureSamples
            : 0,
          band: snap.band,
        };
      })
      .sort((a, b) => a.domain.localeCompare(b.domain, undefined, { numeric: true }));
  }, [model.nodesByCode, model.standardsByGrade, session]);

  const graphTab = (
    <div className="diag-tab-panel diag-graph-panel">
      <div className="diag-panel-head">
        <div>
          <h3>Standards Graph</h3>
        </div>
      </div>

      {currentCandidate ? (
        <div className="diag-graph-current-card">
          <div className="diag-graph-current-head">
            <div>
              <div className="diag-kicker">Current skill probe</div>
              <div className="diag-graph-current-code">
                {currentCandidate.skill_code || currentCandidate.skill_id}
              </div>
              <div className="diag-graph-current-name">
                {currentCandidate.skill_name || 'Unnamed skill'}
              </div>
            </div>
            <div className="diag-graph-current-score">
              <span>Selection score</span>
              <strong>{formatAdaptivePercent(currentCandidate.selection_score)}</strong>
            </div>
          </div>

          <div className="diag-graph-current-toolbar">
            {currentQuestionLevel ? (
              <span className="diag-current-level">
                {currentQuestionLevel.label || formatIxlLevelMeta(currentQuestionLevel)}
              </span>
            ) : (
              <span />
            )}
            {currentViewerUrl ? (
              <a className="diag-current-open" href={currentViewerUrl} target="_blank" rel="noreferrer">
                Open viewer
                <ExternalLink size={14} />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <DomainMasteryPanel
        domains={domainMastery}
        currentDomain={inspectedNode?.domain || currentCandidate?.target_standard_domain || null}
      />

      <div className="diag-legend">
        <span className="diag-legend-item current">Current target</span>
        <span className="diag-legend-item path">Suspected path</span>
        <span className="diag-legend-item changed">Changed last step</span>
        <span className="diag-legend-item mastered">Mastered</span>
        <span className="diag-legend-item unmastered">Weak</span>
        <span className="diag-legend-item mixed">Mixed</span>
      </div>

      <div className="diag-graph-scroll">
        <DiagnosticGraphView
          graph={graph}
          currentTargetCode={session?.current_target_standard_code ?? null}
          currentSourceCode={currentCandidate?.source_standard_code ?? null}
          pathCodes={session?.current_path_codes || []}
          changedCodes={session?.changed_codes || []}
          retainedCodes={session?.session_seen_codes || []}
          leaderboard={session?.leaderboard || []}
          statusByCode={session?.status_by_code || {}}
          onSelectNode={setInspectedCode}
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
          {inspectedNode.description && <p>{plainifyDescription(inspectedNode.description)}</p>}
          <GraphInspectorSkills
            standard={inspectedIxl}
            currentSkillId={
              currentCandidate?.source_standard_code === inspectedNode.code
                ? currentCandidate.skill_id
                : null
            }
            currentLevel={currentQuestionLevel}
            currentViewerUrl={currentViewerUrl}
          />
        </div>
      )}
    </div>
  );

  const currentTab = (
    <div className="diag-tab-panel">
      <div className="diag-panel-head">
        <div>
          <h3>Current Skill Probe</h3>
        </div>
      </div>

      <div className="diag-panel-scroll">
        {currentCandidate ? (
          <CurrentProbeCard
            candidate={currentCandidate}
            hypothesis={session?.current_hypothesis || null}
            modeLabel={modeMeta.get(currentCandidate.mode)?.label ?? currentCandidate.mode}
            onOutcome={handleOutcome}
            branchPreview={session?.branch_preview || []}
            questionLevelLabel={currentQuestionLevel?.label ?? null}
            viewerUrl={currentViewerUrl}
          />
        ) : (
          <div className="diag-empty">
            No current skill is available for this grade. That usually means the current data
            slice has no adaptive candidates to show.
          </div>
        )}
      </div>
    </div>
  );

  const whyTab = (
    <div className="diag-tab-panel">
      <div className="diag-panel-head">
        <div>
          <h3>Why This Skill Won</h3>
        </div>
      </div>

      <div className="diag-panel-scroll">
        {currentCandidate ? (
          <>
            <div className="diag-why-card">
              <div className="diag-subhead">
                <h5>Current decision factors</h5>
                <span>{formatAdaptivePercent(currentCandidate.selection_score)} selection score</span>
              </div>
              <MetricRow label="Target need" value={currentCandidate.influences.target_need} />
              <MetricRow label="Skill prior" value={currentCandidate.influences.artifact_priority} />
              <MetricRow
                label="Uncertainty gain"
                value={currentCandidate.influences.uncertainty_gain}
              />
              <MetricRow
                label="Follow-up pressure"
                value={currentCandidate.influences.followup_pressure}
              />
              <MetricRow label="Source signal" value={currentCandidate.influences.source_signal} />
              <MetricRow
                label="Domain coverage"
                value={currentCandidate.influences.domain_coverage}
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
      </div>
    </div>
  );

  const historyTab = (
    <div className="diag-tab-panel">
      <div className="diag-panel-head">
        <div className="diag-panel-head-bar">
          <h3>Session Timeline</h3>
          <button
            type="button"
            className="diag-export-button"
            onClick={handleExportTimeline}
            disabled={!session?.history.length}
            title="Download session timeline as JSON"
          >
            <Download size={14} />
            Export JSON
          </button>
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
          No simulated answers yet. Pick a Grade, start the session, then mark the current skill
          as correct or incorrect to watch the algorithm move.
        </div>
      )}
    </div>
  );

  const tabs: DiagnosticWorkbenchTab[] = useMemo(
    () => [
      {
        id: 'question',
        label: 'Question',
        content: (
          <DiagnosticQuestionSurface
            candidate={currentCandidate}
            skill={currentIxlSkill}
            selectedLevel={currentQuestionLevel}
            onOutcome={handleOutcome}
          />
        ),
      },
      {
        id: 'current',
        label: 'Current Skill Probe',
        content: currentTab,
      },
      {
        id: 'why',
        label: 'Why This Skill Won',
        content: whyTab,
      },
      {
        id: 'history',
        label: 'Session Timeline',
        content: historyTab,
      },
      {
        id: 'graph',
        label: 'Standards Graph',
        content: graphTab,
      },
    ],
    [currentCandidate, currentIxlSkill, currentQuestionLevel, currentTab, graphTab, historyTab, whyTab],
  );

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
              <span className="diag-step-pill">Step {session.summary.current_step}</span>
              {domainMastery.map((d) => (
                <span
                  key={d.domain}
                  className={`diag-domain-pill diag-band-${DOMAIN_BAND_CLASS[d.band]}`}
                  title={`${d.label} · mastery ${(d.mastery * 100).toFixed(0)}% · ${d.evidenceCount} evidence`}
                >
                  <strong>{d.domain}</strong> {DOMAIN_BAND_LABEL[d.band]}
                </span>
              ))}
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

      <DockableDiagnosticShell
        tabs={tabs}
        defaultLayout={DIAGNOSTIC_WORKBENCH_DEFAULT}
      />
    </>
  );
}

function CurrentProbeCard({
  candidate,
  hypothesis,
  modeLabel,
  onOutcome,
  branchPreview,
  questionLevelLabel,
  viewerUrl,
}: {
  candidate: DiagnosticCandidateView;
  hypothesis: string | null;
  modeLabel: string;
  onOutcome: (outcome: DiagnosticOutcome) => void;
  branchPreview: DiagnosticBranchPreview[];
  questionLevelLabel: string | null;
  viewerUrl: string | null;
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

      {(questionLevelLabel || viewerUrl) && (
        <div className="diag-current-toolbar">
          {questionLevelLabel ? (
            <span className="diag-current-level">{questionLevelLabel}</span>
          ) : (
            <span />
          )}
          {viewerUrl ? (
            <a className="diag-current-open" href={viewerUrl} target="_blank" rel="noreferrer">
              Open viewer
              <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      )}

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
          <span>The immediate next recommendation after this answer</span>
        </div>
        <div className="diag-branch-grid">
          {branchPreview.map((branch) => (
            <div key={branch.outcome} className="diag-branch-card">
              <div className="diag-branch-card-head">
                <div className={`diag-outcome-tag ${branch.outcome}`}>{branch.label}</div>
                {branch.reasoning.length ? (
                  <div className="diag-branch-info-wrap">
                    <button
                      type="button"
                      className="diag-branch-info-button"
                      aria-label={`Why ${branch.label} leads to this branch`}
                    >
                      <CircleHelp size={14} />
                    </button>
                    <div className="diag-branch-popover" role="tooltip">
                      <div className="diag-branch-popover-title">
                        Why this branch skill is selected
                      </div>
                      <ul className="diag-branch-popover-list">
                        {branch.reasoning.map((reason) => (
                          <li key={`${branch.outcome}:${reason}`}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="diag-branch-list">
                {branch.next_recommendation ? (
                  <div
                    key={`${branch.outcome}:${branch.next_recommendation.target_standard_code}:${branch.next_recommendation.skill_id}`}
                  >
                    <strong>
                      {branch.next_recommendation.skill_code || branch.next_recommendation.skill_id}
                    </strong>
                    <span>
                      {branch.next_recommendation.target_standard_code} via{' '}
                      {branch.next_recommendation.source_standard_code}
                    </span>
                  </div>
                ) : (
                  <span>No next skill available.</span>
                )}
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

function DomainMasteryPanel({
  domains,
  currentDomain,
}: {
  domains: DomainMasterySummary[];
  currentDomain: string | null;
}) {
  if (!domains.length) return null;

  return (
    <section className="diag-domain-panel">
      <div className="diag-subhead">
        <h5>Domain mastery</h5>
        <span>{domains.length} domains</span>
      </div>
      <div className="diag-domain-matrix">
        {domains.map((domain) => (
          <div
            key={domain.domain}
            className={domain.domain === currentDomain ? 'diag-domain-row active' : 'diag-domain-row'}
          >
            <div className="diag-domain-title">
              <span
                className="diag-domain-swatch"
                style={{ backgroundColor: domainColor(domain.domain) }}
                aria-hidden="true"
              />
              <div className="diag-domain-title-text">
                <div>
                  <strong>{domain.domain}</strong>
                  <span>{domain.label || domain.domain}</span>
                </div>
                <em>{domain.standardCount} standards</em>
              </div>
            </div>

            <div className="diag-domain-measure">
              <span>Mastery</span>
              <strong>{formatAdaptivePercent(domain.mastery)}</strong>
              <div className="diag-domain-bar">
                <i style={{ width: `${domain.mastery * 100}%` }} />
              </div>
            </div>

            <div className="diag-domain-measure">
              <span>Confidence</span>
              <strong>{formatAdaptivePercent(domain.confidence)}</strong>
              <div className="diag-domain-bar">
                <i style={{ width: `${domain.confidence * 100}%` }} />
              </div>
            </div>

            <div className="diag-domain-measure compact">
              <span>Evidence</span>
              <strong>{domain.evidenceCount}</strong>
            </div>

            <div className="diag-domain-measure">
              <span>Pressure</span>
              <strong>{formatAdaptivePercent(domain.pressure)}</strong>
              <div className="diag-domain-bar">
                <i style={{ width: `${domain.pressure * 100}%` }} />
              </div>
            </div>

            <div className="diag-domain-counts">
              <span>M {domain.masteredCount}</span>
              <span>W {domain.weakCount}</span>
              <span>U {domain.unknownCount}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GraphInspectorSkills({
  standard,
  currentSkillId,
  currentLevel,
  currentViewerUrl,
}: {
  standard: CoherenceIxlStandard | null;
  currentSkillId: string | null;
  currentLevel: CoherenceIxlStandard['skills'][number]['levels'][number] | null;
  currentViewerUrl: string | null;
}) {
  return (
    <div className="diag-inspector-skills">
      <div className="diag-subhead">
        <h5>Mapped skills</h5>
        <span>{standard?.skill_count ?? 0} shown</span>
      </div>

      {!standard?.skills.length ? (
        <div className="diag-empty diag-empty-compact">
          No mapped IXL skills are attached to this standard in the current scrape.
        </div>
      ) : (
        <div className="diag-inspector-skill-list">
          {standard.skills.map((skill) => {
            const isCurrent = currentSkillId === skill.skill_id;
            const orderedLevels = sortIxlLevels(skill.levels);
            const sampleLevel = isCurrent && currentLevel ? currentLevel : orderedLevels[0] ?? null;
            const sampleUrl =
              isCurrent && currentViewerUrl
                ? currentViewerUrl
                : sampleLevel
                  ? buildIxlViewerUrl(sampleLevel)
                  : null;

            return (
              <article
                key={`${standard.standard_code}:${skill.skill_id}`}
                className={isCurrent ? 'diag-inspector-skill active' : 'diag-inspector-skill'}
              >
                <div className="diag-inspector-skill-head">
                  <div>
                    <div className="diag-inspector-skill-code">
                      {skill.skill_code || skill.skill_id}
                    </div>
                    <div className="diag-inspector-skill-name">
                      {skill.skill_name || 'Unnamed skill'}
                    </div>
                  </div>
                  {isCurrent ? <span className="diag-inspector-skill-current">Current</span> : null}
                </div>

                <div className="diag-inspector-skill-meta">
                  <span>{skill.question_file_count} files</span>
                  <span>{skill.num_levels} levels</span>
                  <span>{skill.question_count} questions</span>
                </div>

                {sampleLevel ? (
                  <div className="diag-inspector-skill-footer">
                    <span>{sampleLevel.label || formatIxlLevelMeta(sampleLevel)}</span>
                    {sampleUrl ? (
                      <a href={sampleUrl} target="_blank" rel="noreferrer">
                        Open sample
                        <ExternalLink size={12} />
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
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
