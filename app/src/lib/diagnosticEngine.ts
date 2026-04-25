import {
  type CoherenceGraph,
  type CoherenceNode,
  gradeRank,
  plainifyDescription,
} from '@/lib/coherence';
import type {
  AdaptiveDiagnosticCandidate,
  AdaptiveDiagnosticIndex,
  AdaptiveDiagnosticPlan,
  AdaptiveModeId,
} from '@/lib/coherenceAdaptive';

const OUTCOME_META = {
  correct: { label: 'Correct', observed: 1, confidence: 0.24 },
  partial: { label: 'Partially correct', observed: 0.68, confidence: 0.18 },
  unsure: { label: 'Unsure', observed: 0.42, confidence: 0.12 },
  incorrect: { label: 'Incorrect', observed: 0.08, confidence: 0.24 },
} as const;

const OUTCOME_ORDER = ['correct', 'partial', 'unsure', 'incorrect'] as const;
const FOLLOWUP_DECAY = 0.74;
const PRESSURE_DECAY = 0.88;
const STATUS_UNKNOWN_CONFIDENCE = 0.24;
const STATUS_CONFIDENT = 0.42;
const FOLLOWUP_MAX_SCORE_GAP = 0.045;
const MAX_CONSECUTIVE_TARGET_RUN = 2;

export type DiagnosticOutcome = (typeof OUTCOME_ORDER)[number];
export type DiagnosticStandardStatus = 'mastered' | 'unmastered' | 'mixed' | 'unknown';

export type DiagnosticModel = {
  grades: string[];
  nodesByCode: Map<string, CoherenceNode>;
  graphNodesByCode: Map<string, CoherenceNode>;
  plansByCode: Map<string, AdaptiveDiagnosticPlan>;
  standardsByGrade: Map<string, string[]>;
  forward: Map<string, string[]>;
  reverse: Map<string, string[]>;
  graphForward: Map<string, string[]>;
  graphReverse: Map<string, string[]>;
  pathCache: Map<string, string[]>;
  totalSkillCandidatesByGrade: Map<string, number>;
};

type StandardState = {
  code: string;
  grade: string | null;
  domain: string | null;
  mastery: number;
  confidence: number;
  evidenceCount: number;
  directEvidenceCount: number;
  indirectEvidenceCount: number;
  attention: number;
  prerequisitePressure: number;
  recoveryPressure: number;
};

type SkillState = {
  key: string;
  skillId: string;
  sourceStandardCode: string;
  mastery: number;
  confidence: number;
  evidenceCount: number;
  lastOutcome: DiagnosticOutcome | null;
};

export type DiagnosticSkillSnapshot = {
  key: string;
  skill_id: string;
  source_standard_code: string;
  mastery: number;
  confidence: number;
  evidence_count: number;
  last_outcome: DiagnosticOutcome | null;
};

export type DiagnosticCandidateView = AdaptiveDiagnosticCandidate & {
  target_standard_code: string;
  target_standard_grade: string | null;
  target_standard_domain: string | null;
  mode: AdaptiveModeId;
  selection_score: number;
  influences: {
    target_need: number;
    artifact_priority: number;
    uncertainty_gain: number;
    followup_pressure: number;
    source_signal: number;
    domain_coverage: number;
  };
  reasons: string[];
};

export type DiagnosticBranchPreview = {
  outcome: DiagnosticOutcome;
  label: string;
  next_target_standard_code: string | null;
  next_recommendation: DiagnosticCandidateView | null;
  reasoning: string[];
};

export type DiagnosticHistoryEntry = {
  step: number;
  outcome: DiagnosticOutcome;
  outcome_label: string;
  candidate: DiagnosticCandidateView;
  changed_codes: string[];
  path_codes: string[];
  surfaced_codes: string[];
  visible_codes: string[];
  summary: string;
  next_target_standard_code: string | null;
  next_skill_label: string | null;
};

export type DiagnosticSessionSummary = {
  current_step: number;
  grade_standard_count: number;
  surfaced_standard_count: number;
  mastered_skill_count: number;
  unmastered_skill_count: number;
  unknown_skill_count: number;
};

export type DiagnosticSessionView = {
  grade: string;
  current_recommendation: DiagnosticCandidateView | null;
  current_hypothesis: string | null;
  current_path_codes: string[];
  current_target_standard_code: string | null;
  leaderboard: DiagnosticCandidateView[];
  branch_preview: DiagnosticBranchPreview[];
  history: DiagnosticHistoryEntry[];
  summary: DiagnosticSessionSummary;
  status_by_code: Record<string, DiagnosticStandardStatus>;
  standard_state_by_code: Record<string, StandardState>;
  skill_state_by_key: Record<string, DiagnosticSkillSnapshot>;
  changed_codes: string[];
  session_seen_codes: string[];
};

type RecommendationState = {
  recommendation: DiagnosticCandidateView | null;
  leaderboard: DiagnosticCandidateView[];
  hypothesis: string | null;
  pathCodes: string[];
  targetStandardCode: string | null;
};

type FollowupContext = {
  targetStandardCode: string;
  mode: AdaptiveModeId;
  relationPreference: AdaptiveDiagnosticCandidate['relation'] | null;
};

type DomainCoverageContext = {
  domainEvidenceByDomain: Map<string, number>;
  domainStandardCountByDomain: Map<string, number>;
  domainCoverageGapByDomain: Map<string, number>;
};

type SimulationOptions = {
  includeBranchPreview?: boolean;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatSelectionPercent(value: number) {
  return `${Math.round(clamp(value) * 100)}%`;
}

export function diagnosticSkillKey(
  candidate: Pick<AdaptiveDiagnosticCandidate, 'source_standard_code' | 'skill_id'>,
) {
  return `${candidate.source_standard_code}:${candidate.skill_id}`;
}

function sameCandidate(
  left: Pick<DiagnosticCandidateView, 'target_standard_code' | 'source_standard_code' | 'skill_id'>,
  right: Pick<DiagnosticCandidateView, 'target_standard_code' | 'source_standard_code' | 'skill_id'>,
) {
  return (
    left.target_standard_code === right.target_standard_code &&
    left.source_standard_code === right.source_standard_code &&
    left.skill_id === right.skill_id
  );
}

function buildAdjacency(graph: CoherenceGraph, nodesByCode: Map<string, CoherenceNode>) {
  const idToCode = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.code && nodesByCode.has(node.code)) idToCode.set(node.id, node.code);
  }

  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.label !== 'buildsTowards') continue;
    const sourceCode = idToCode.get(edge.source);
    const targetCode = idToCode.get(edge.target);
    if (!sourceCode || !targetCode) continue;
    const forwardRow = forward.get(sourceCode);
    if (forwardRow) forwardRow.push(targetCode);
    else forward.set(sourceCode, [targetCode]);
    const reverseRow = reverse.get(targetCode);
    if (reverseRow) reverseRow.push(sourceCode);
    else reverse.set(targetCode, [sourceCode]);
  }
  return { forward, reverse };
}

function uniqueCandidateCount(plans: AdaptiveDiagnosticPlan[]) {
  const keys = new Set<string>();
  for (const plan of plans) {
    for (const candidates of Object.values(plan.candidates)) {
      for (const candidate of candidates) {
        keys.add(diagnosticSkillKey(candidate));
      }
    }
  }
  return keys.size;
}

function getOrCreateStandardState(
  model: DiagnosticModel,
  standardStates: Map<string, StandardState>,
  code: string,
) {
  const existing = standardStates.get(code);
  if (existing) return existing;
  const node = model.nodesByCode.get(code) ?? null;
  const next: StandardState = {
    code,
    grade: node?.grade ?? null,
    domain: node?.domain ?? null,
    mastery: 0.5,
    confidence: 0,
    evidenceCount: 0,
    directEvidenceCount: 0,
    indirectEvidenceCount: 0,
    attention: 0,
    prerequisitePressure: 0,
    recoveryPressure: 0,
  };
  standardStates.set(code, next);
  return next;
}

function getOrCreateSkillState(
  skillStates: Map<string, SkillState>,
  candidate: AdaptiveDiagnosticCandidate,
) {
  const key = diagnosticSkillKey(candidate);
  const existing = skillStates.get(key);
  if (existing) return existing;
  const next: SkillState = {
    key,
    skillId: candidate.skill_id,
    sourceStandardCode: candidate.source_standard_code,
    mastery: 0.5,
    confidence: 0,
    evidenceCount: 0,
    lastOutcome: null,
  };
  skillStates.set(key, next);
  return next;
}

function classifyStatus(mastery: number, confidence: number): DiagnosticStandardStatus {
  if (confidence < STATUS_UNKNOWN_CONFIDENCE) return 'unknown';
  if (confidence >= STATUS_CONFIDENT && mastery >= 0.72) return 'mastered';
  if (confidence >= STATUS_CONFIDENT && mastery <= 0.38) return 'unmastered';
  return 'mixed';
}

function updatePosterior(current: number, observed: number, weight: number) {
  return round(clamp(current + weight * (observed - current)));
}

function explainCandidate(
  candidate: AdaptiveDiagnosticCandidate,
  mode: AdaptiveModeId,
  targetCode: string,
  targetState: StandardState,
  sourceState: StandardState,
  influences: DiagnosticCandidateView['influences'],
) {
  const reasons: string[] = [];
  if (candidate.relation === 'focus') {
    reasons.push(`Direct probe on ${targetCode} while the grade-level picture is still incomplete.`);
  } else if (candidate.relation === 'ancestor') {
    reasons.push(
      `Prerequisite trace from ${candidate.source_standard_code} because the target standard still looks weak or unresolved.`,
    );
  } else {
    reasons.push(
      `Recovery check on ${candidate.source_standard_code} to see whether understanding carries forward again.`,
    );
  }

  if (targetState.confidence < 0.45) {
    reasons.push('Target-standard confidence is still low, so the engine prefers clean evidence.');
  }
  if (influences.domain_coverage >= 0.5) {
    reasons.push('This target helps fill an under-sampled domain, improving the grade-wide mastery estimate.');
  }
  if (targetState.prerequisitePressure >= 0.24 && mode === 'prerequisite') {
    reasons.push('Recent simulated errors raised the likelihood of a prerequisite gap.');
  }
  if (targetState.recoveryPressure >= 0.24 && mode === 'recovery') {
    reasons.push('Recent simulated success on an earlier skill shifted the engine into a recovery check.');
  }
  if (candidate.question_file_count >= 2 || candidate.num_levels >= 2) {
    reasons.push(
      `Observed scrape coverage is strong enough to make this skill a stable signal (${candidate.question_file_count} files, ${candidate.num_levels} levels).`,
    );
  }
  if (influences.uncertainty_gain >= 0.5) {
    reasons.push('This skill has not been used much yet, so it still offers good uncertainty reduction.');
  }
  if (sourceState.confidence >= STATUS_CONFIDENT) {
    reasons.push('The linked source standard already has evidence, so this choice also acts as a consistency check.');
  }

  return reasons.slice(0, 4);
}

function determineMode(state: StandardState, sameGrade: boolean): AdaptiveModeId {
  if (state.recoveryPressure >= Math.max(0.28, state.prerequisitePressure + 0.05)) {
    return 'recovery';
  }
  if (state.prerequisitePressure >= 0.24 || (!sameGrade && state.attention >= 0.18)) {
    return 'prerequisite';
  }
  return 'baseline';
}

function domainKey(domain: string | null | undefined) {
  return domain || 'Unknown';
}

function trailingTargetRun(recentTargetCodes: string[], code: string) {
  let count = 0;
  for (let index = recentTargetCodes.length - 1; index >= 0; index -= 1) {
    if (recentTargetCodes[index] !== code) break;
    count += 1;
  }
  return count;
}

function recentTargetCount(recentTargetCodes: string[], code: string) {
  return recentTargetCodes.filter((targetCode) => targetCode === code).length;
}

function buildDomainCoverageContext(
  model: DiagnosticModel,
  grade: string,
  standardStates: Map<string, StandardState>,
): DomainCoverageContext {
  const domainEvidenceByDomain = new Map<string, number>();
  const domainStandardCountByDomain = new Map<string, number>();
  const domainCoverageGapByDomain = new Map<string, number>();

  for (const code of model.standardsByGrade.get(grade) || []) {
    const node = model.nodesByCode.get(code);
    const domain = domainKey(node?.domain);
    const state = getOrCreateStandardState(model, standardStates, code);
    domainStandardCountByDomain.set(domain, (domainStandardCountByDomain.get(domain) || 0) + 1);
    domainEvidenceByDomain.set(domain, (domainEvidenceByDomain.get(domain) || 0) + state.directEvidenceCount);
  }

  for (const [domain, standardCount] of domainStandardCountByDomain) {
    const evidenceCount = domainEvidenceByDomain.get(domain) || 0;
    const targetSamples = Math.min(2, Math.max(1, Math.ceil(standardCount / 6)));
    domainCoverageGapByDomain.set(domain, clamp((targetSamples - evidenceCount) / targetSamples));
  }

  return {
    domainEvidenceByDomain,
    domainStandardCountByDomain,
    domainCoverageGapByDomain,
  };
}

function standardNeedScore(
  plan: AdaptiveDiagnosticPlan,
  state: StandardState,
  grade: string,
  lastRecommendation: DiagnosticCandidateView | null,
  coverage: DomainCoverageContext,
  recentTargetCodes: string[],
  recentTargetDomains: string[],
) {
  const sameGrade = plan.focus_grade === grade;
  const unknown = state.evidenceCount === 0 ? 1 : 0;
  const directUnknown = sameGrade && state.directEvidenceCount === 0 ? 1 : 0;
  const uncertainty = 1 - state.confidence;
  const weakness = clamp((0.5 - state.mastery) / 0.5);
  const followup = Math.max(state.attention, state.prerequisitePressure, state.recoveryPressure);
  const impact = plan.descendant_standard_count ? clamp(plan.descendant_standard_count / 12) : 0;
  const domainCoverage = sameGrade
    ? coverage.domainCoverageGapByDomain.get(domainKey(plan.focus_domain)) || 0
    : 0;
  const consecutiveTargetRun = trailingTargetRun(recentTargetCodes, plan.focus_standard_code);
  const recentTargetPressure = recentTargetCount(recentTargetCodes.slice(-6), plan.focus_standard_code);
  const currentDomain = domainKey(plan.focus_domain);
  const consecutiveDomainRun = trailingTargetRun(recentTargetDomains, currentDomain);
  const recentDomainPressure = recentTargetCount(recentTargetDomains.slice(-6), currentDomain);
  const revisitBoost =
    lastRecommendation?.target_standard_code !== plan.focus_standard_code
      ? 0
    : state.prerequisitePressure >= 0.22
        ? 0.18
        : state.recoveryPressure >= 0.24
          ? 0.12
          : state.attention >= 0.32 && state.confidence < 0.3
            ? 0.1
            : 0;
  const repeatPenalty =
    consecutiveTargetRun
      ? Math.min(
          0.28,
          (followup >= 0.35 ? 0.05 : 0.1) * consecutiveTargetRun +
            0.035 * recentTargetPressure,
        )
      : 0;
  const measuredPenalty =
    sameGrade && state.directEvidenceCount > 0 && state.confidence >= STATUS_CONFIDENT && followup < 0.24
      ? 0.16
      : 0;
  const domainRepeatPenalty =
    sameGrade && domainCoverage < 0.9
      ? Math.min(0.32, 0.08 * consecutiveDomainRun + 0.05 * recentDomainPressure)
      : 0;

  return round(
    clamp(
      (sameGrade ? 0.14 : 0.05) +
        0.15 * unknown +
        0.1 * directUnknown +
        0.17 * uncertainty +
        0.15 * weakness +
        0.1 * followup +
        0.05 * impact +
        0.35 * domainCoverage +
        revisitBoost -
        repeatPenalty -
        measuredPenalty -
        domainRepeatPenalty,
    ),
  );
}

function candidateScore(
  targetNeed: number,
  domainCoverage: number,
  candidate: AdaptiveDiagnosticCandidate,
  mode: AdaptiveModeId,
  targetState: StandardState,
  sourceState: StandardState,
  skillState: SkillState,
  lastRecommendation: DiagnosticCandidateView | null,
  recentTargetCodes: string[],
) {
  const uncertaintyGain = clamp(1 - Math.min(skillState.confidence, 0.9));
  const followupPressure =
    candidate.relation === 'ancestor'
      ? Math.max(targetState.prerequisitePressure, sourceState.attention)
      : candidate.relation === 'descendant'
        ? Math.max(targetState.recoveryPressure, sourceState.attention)
        : Math.max(targetState.attention, 1 - targetState.confidence);
  const sourceSignal = Math.max(
    clamp((0.5 - sourceState.mastery) / 0.5),
    1 - sourceState.confidence,
  );
  const repeatPenalty =
    lastRecommendation && diagnosticSkillKey(lastRecommendation) === diagnosticSkillKey(candidate)
      ? 0.16
      : 0;
  const targetRun = trailingTargetRun(recentTargetCodes, targetState.code);
  const sameTargetPenalty =
    targetRun ? Math.min(0.22, (followupPressure >= 0.36 ? 0.045 : 0.075) * targetRun) : 0;

  const selectionScore = round(
    clamp(
      0.3 * targetNeed +
        0.24 * candidate.score +
        0.14 * uncertaintyGain +
        0.07 * followupPressure +
        0.04 * sourceSignal +
        0.1 * domainCoverage -
        repeatPenalty -
        sameTargetPenalty,
    ),
  );

  const influences = {
    target_need: targetNeed,
    artifact_priority: candidate.score,
    uncertainty_gain: uncertaintyGain,
    followup_pressure: followupPressure,
    source_signal: sourceSignal,
    domain_coverage: domainCoverage,
  };

  return {
    selectionScore,
    influences,
    reasons: explainCandidate(candidate, mode, targetState.code, targetState, sourceState, influences),
  };
}

function shortestPath(
  model: DiagnosticModel,
  sourceCode: string,
  targetCode: string,
  adjacency: Map<string, string[]>,
) {
  const cacheKey = `${sourceCode}>${targetCode}`;
  const cached = model.pathCache.get(cacheKey);
  if (cached) return cached;

  const queue: Array<{ code: string; path: string[] }> = [{ code: sourceCode, path: [sourceCode] }];
  const seen = new Set<string>([sourceCode]);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    if (current.code === targetCode) {
      model.pathCache.set(cacheKey, current.path);
      return current.path;
    }
    for (const next of adjacency.get(current.code) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ code: next, path: [...current.path, next] });
    }
  }

  const fallback = sourceCode === targetCode ? [sourceCode] : [sourceCode, targetCode];
  model.pathCache.set(cacheKey, fallback);
  return fallback;
}

function buildPathCodes(model: DiagnosticModel, candidate: DiagnosticCandidateView) {
  if (candidate.relation === 'focus') return [candidate.target_standard_code];
  if (candidate.relation === 'ancestor') {
    return shortestPath(
      model,
      candidate.source_standard_code,
      candidate.target_standard_code,
      model.forward,
    );
  }
  return shortestPath(
    model,
    candidate.target_standard_code,
    candidate.source_standard_code,
    model.forward,
  );
}

function buildHypothesis(
  model: DiagnosticModel,
  candidate: DiagnosticCandidateView | null,
  standardStates: Map<string, StandardState>,
) {
  if (!candidate) return null;
  const targetNode = model.nodesByCode.get(candidate.target_standard_code);
  const sourceNode = model.nodesByCode.get(candidate.source_standard_code);
  const targetLabel = targetNode?.description
    ? plainifyDescription(targetNode.description)
    : candidate.target_standard_code;

  if (candidate.relation === 'focus') {
    return `The engine is still measuring ${candidate.target_standard_code} directly because the current evidence on "${targetLabel}" is not stable enough yet.`;
  }

  if (candidate.relation === 'ancestor') {
    const sourceState = standardStates.get(candidate.source_standard_code);
    const sourceLabel = sourceNode?.description
      ? plainifyDescription(sourceNode.description)
      : candidate.source_standard_code;
    const gapText =
      sourceState && sourceState.mastery <= 0.38 && sourceState.confidence >= STATUS_CONFIDENT
        ? 'Current evidence points to a likely prerequisite gap'
        : 'The engine is testing whether an older prerequisite might explain the current weakness';
    return `${gapText} on ${candidate.source_standard_code} (${sourceLabel}) before it commits to more work on ${candidate.target_standard_code}.`;
  }

  return `The engine is checking whether progress on ${candidate.target_standard_code} now transfers forward to ${candidate.source_standard_code}.`;
}

function decayAllStates(standardStates: Map<string, StandardState>) {
  for (const state of standardStates.values()) {
    state.attention = round(state.attention * FOLLOWUP_DECAY);
    state.prerequisitePressure = round(state.prerequisitePressure * PRESSURE_DECAY);
    state.recoveryPressure = round(state.recoveryPressure * PRESSURE_DECAY);
  }
}

function boostAncestors(
  model: DiagnosticModel,
  standardStates: Map<string, StandardState>,
  startCode: string,
  baseBoost: number,
) {
  const queue: Array<{ code: string; distance: number }> = [{ code: startCode, distance: 0 }];
  const seen = new Set<string>([startCode]);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    for (const parent of model.reverse.get(current.code) || []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      const state = getOrCreateStandardState(model, standardStates, parent);
      const boost = clamp(baseBoost / (current.distance + 2), 0, 0.24);
      state.attention = round(clamp(state.attention + boost));
      queue.push({ code: parent, distance: current.distance + 1 });
    }
  }
}

function boostDescendants(
  model: DiagnosticModel,
  standardStates: Map<string, StandardState>,
  startCode: string,
  baseBoost: number,
) {
  const queue: Array<{ code: string; distance: number }> = [{ code: startCode, distance: 0 }];
  const seen = new Set<string>([startCode]);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    for (const next of model.forward.get(current.code) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const state = getOrCreateStandardState(model, standardStates, next);
      const boost = clamp(baseBoost / (current.distance + 2), 0, 0.18);
      state.attention = round(clamp(state.attention + boost));
      queue.push({ code: next, distance: current.distance + 1 });
    }
  }
}

function buildHistorySummary(
  candidate: DiagnosticCandidateView,
  outcome: DiagnosticOutcome,
  nextRecommendation: DiagnosticCandidateView | null,
) {
  const outcomeLabel = OUTCOME_META[outcome].label.toLowerCase();
  const currentLabel = candidate.skill_code || candidate.skill_id;
  if (!nextRecommendation) {
    return `Marked ${currentLabel} as ${outcomeLabel}. No next skill is currently available.`;
  }
  const nextLabel = nextRecommendation.skill_code || nextRecommendation.skill_id;
  if (candidate.relation === 'ancestor' && outcome === 'correct') {
    return `Marked ${currentLabel} as ${outcomeLabel}. The engine now shifts forward to ${nextLabel} to see whether the earlier foundation transfers back into the target standard.`;
  }
  if (candidate.relation === 'focus' && outcome === 'incorrect') {
    return `Marked ${currentLabel} as ${outcomeLabel}. The engine now leans harder on prerequisite tracing and moves to ${nextLabel}.`;
  }
  return `Marked ${currentLabel} as ${outcomeLabel}. The next recommended skill is ${nextLabel}.`;
}

function buildFollowupContext(
  recommendation: DiagnosticCandidateView,
  outcome: DiagnosticOutcome,
): FollowupContext | null {
  if (recommendation.relation === 'focus') {
    if (outcome === 'incorrect' || outcome === 'unsure') {
      return {
        targetStandardCode: recommendation.target_standard_code,
        mode: 'prerequisite',
        relationPreference: 'ancestor',
      };
    }
    return null;
  }

  if (recommendation.relation === 'ancestor') {
    if (outcome === 'incorrect' || outcome === 'unsure') {
      return {
        targetStandardCode: recommendation.target_standard_code,
        mode: 'prerequisite',
        relationPreference: 'ancestor',
      };
    }
    return null;
  }

  if (outcome === 'incorrect' || outcome === 'unsure') {
    return {
      targetStandardCode: recommendation.target_standard_code,
      mode: 'baseline',
      relationPreference: 'focus',
    };
  }

  return null;
}

function collectSurfacedCodes(
  current: RecommendationState,
  changedCodes: string[] = [],
) {
  const surfaced = new Set<string>(changedCodes);
  if (current.targetStandardCode) surfaced.add(current.targetStandardCode);
  if (current.recommendation?.source_standard_code) {
    surfaced.add(current.recommendation.source_standard_code);
  }
  for (const code of current.pathCodes) surfaced.add(code);
  for (const candidate of current.leaderboard) {
    surfaced.add(candidate.target_standard_code);
    surfaced.add(candidate.source_standard_code);
  }
  return [...surfaced];
}

function collectVisibleCodes(
  model: DiagnosticModel,
  current: RecommendationState,
  changedCodes: string[] = [],
) {
  const visible = new Set<string>();
  const seedCodes = new Set<string>(changedCodes);

  if (current.targetStandardCode) seedCodes.add(current.targetStandardCode);
  if (current.recommendation?.source_standard_code) {
    seedCodes.add(current.recommendation.source_standard_code);
  }
  for (const code of current.pathCodes) seedCodes.add(code);
  for (const candidate of current.leaderboard.slice(0, 6)) {
    seedCodes.add(candidate.target_standard_code);
    seedCodes.add(candidate.source_standard_code);
  }

  for (const code of seedCodes) {
    if (!model.graphNodesByCode.has(code)) continue;
    visible.add(code);
    for (const parent of model.graphReverse.get(code) || []) {
      if (model.graphNodesByCode.has(parent)) visible.add(parent);
    }
    for (const child of model.graphForward.get(code) || []) {
      if (model.graphNodesByCode.has(child)) visible.add(child);
    }
  }

  return [...visible];
}

function cloneStandardStates(standardStates: Map<string, StandardState>) {
  const cloned = new Map<string, StandardState>();
  for (const [code, state] of standardStates) {
    cloned.set(code, { ...state });
  }
  return cloned;
}

function cloneSkillStates(skillStates: Map<string, SkillState>) {
  const cloned = new Map<string, SkillState>();
  for (const [key, state] of skillStates) {
    cloned.set(key, { ...state });
  }
  return cloned;
}

function buildBranchPreview(
  model: DiagnosticModel,
  grade: string,
  standardStates: Map<string, StandardState>,
  skillStates: Map<string, SkillState>,
  recommendation: DiagnosticCandidateView | null,
  recentTargetCodes: string[],
) {
  if (!recommendation) return [];

  return OUTCOME_ORDER.map((outcome) => {
    const branchStandardStates = cloneStandardStates(standardStates);
    const branchSkillStates = cloneSkillStates(skillStates);
    applyOutcome(
      model,
      branchStandardStates,
      branchSkillStates,
      recommendation,
      outcome,
    );
    const branchFollowupContext = buildFollowupContext(recommendation, outcome);
    const branchRecentTargetCodes = [...recentTargetCodes, recommendation.target_standard_code];
    const preview = computeRecommendationState(
      model,
      grade,
      branchStandardStates,
      branchSkillStates,
      recommendation,
      branchFollowupContext,
      branchRecentTargetCodes,
    );

    return {
      outcome,
      label: OUTCOME_META[outcome].label,
      next_target_standard_code: preview.targetStandardCode,
      next_recommendation: preview.recommendation,
      reasoning: buildBranchReasoning(outcome, recommendation, preview.recommendation),
    } satisfies DiagnosticBranchPreview;
  });
}

function buildBranchReasoning(
  outcome: DiagnosticOutcome,
  currentRecommendation: DiagnosticCandidateView,
  nextRecommendation: DiagnosticCandidateView | null,
) {
  const outcomeLabel = OUTCOME_META[outcome].label.toLowerCase();

  if (!nextRecommendation) {
    return [`After a ${outcomeLabel} response on ${currentRecommendation.skill_code || currentRecommendation.skill_id}, the engine has no strong next probe to show.`];
  }

  const nextLabel = nextRecommendation.skill_code || nextRecommendation.skill_id;
  const lines: string[] = [];

  if (outcome === 'correct' || outcome === 'partial') {
    if (nextRecommendation.relation === 'focus') {
      lines.push(
        nextRecommendation.target_standard_code === currentRecommendation.target_standard_code
          ? `A ${outcomeLabel} response keeps the engine on the current target because it still wants cleaner evidence on ${nextRecommendation.target_standard_code}.`
          : `A ${outcomeLabel} response gives enough evidence to move to another direct domain sample on ${nextRecommendation.target_standard_code}.`,
      );
    } else if (nextRecommendation.relation === 'descendant') {
      lines.push(
        `A ${outcomeLabel} response raises confidence enough to test whether the skill transfers forward into ${nextRecommendation.source_standard_code}.`,
      );
    } else {
      lines.push(
        `Even after a ${outcomeLabel} response, the engine still sees prerequisite uncertainty and checks ${nextRecommendation.source_standard_code}.`,
      );
    }
  } else if (nextRecommendation.relation === 'ancestor') {
    lines.push(
      `A ${outcomeLabel} response increases prerequisite pressure, so the engine moves backward to ${nextRecommendation.source_standard_code}.`,
    );
  } else {
    lines.push(
      `A ${outcomeLabel} response changes the next best probe to ${nextRecommendation.target_standard_code}.`,
    );
  }

  lines.push(
    `${nextLabel} wins this branch with a ${formatSelectionPercent(nextRecommendation.selection_score)} selection score.`,
  );

  for (const reason of nextRecommendation.reasons.slice(0, 3)) {
    lines.push(reason);
  }

  return lines;
}

function applyStandardObservation(
  state: StandardState,
  observed: number,
  confidenceDelta: number,
  masteryWeight: number,
  confidenceWeight: number,
  evidenceKind: 'direct' | 'indirect',
) {
  state.mastery = updatePosterior(state.mastery, observed, masteryWeight);
  state.confidence = round(clamp(state.confidence + confidenceDelta * confidenceWeight));
  state.evidenceCount += 1;
  if (evidenceKind === 'direct') state.directEvidenceCount += 1;
  else state.indirectEvidenceCount += 1;
}

function applyOutcome(
  model: DiagnosticModel,
  standardStates: Map<string, StandardState>,
  skillStates: Map<string, SkillState>,
  recommendation: DiagnosticCandidateView,
  outcome: DiagnosticOutcome,
) {
  decayAllStates(standardStates);

  const observed = OUTCOME_META[outcome].observed;
  const confidenceDelta = OUTCOME_META[outcome].confidence;
  const changed = new Set<string>();

  const sourceState = getOrCreateStandardState(model, standardStates, recommendation.source_standard_code);
  const targetState = getOrCreateStandardState(model, standardStates, recommendation.target_standard_code);
  const skillState = getOrCreateSkillState(skillStates, recommendation);

  skillState.mastery = updatePosterior(skillState.mastery, observed, 0.48);
  skillState.confidence = round(clamp(skillState.confidence + confidenceDelta));
  skillState.evidenceCount += 1;
  skillState.lastOutcome = outcome;

  applyStandardObservation(
    sourceState,
    observed,
    confidenceDelta,
    recommendation.relation === 'focus' ? 0.46 : 0.35,
    recommendation.relation === 'focus' ? 0.95 : 0.82,
    'direct',
  );
  sourceState.attention = round(clamp(sourceState.attention + 0.18));
  changed.add(sourceState.code);

  targetState.attention = round(clamp(targetState.attention + 0.2));
  if (targetState.code !== sourceState.code) changed.add(targetState.code);

  if (recommendation.relation === 'focus') {
    if (observed < 0.5) {
      targetState.prerequisitePressure = round(clamp(targetState.prerequisitePressure + 0.26));
      targetState.recoveryPressure = round(targetState.recoveryPressure * 0.55);
      boostAncestors(model, standardStates, targetState.code, 0.22);
    } else {
      targetState.prerequisitePressure = round(targetState.prerequisitePressure * 0.62);
      if (observed > 0.85) {
        boostDescendants(model, standardStates, targetState.code, 0.12);
      }
    }
  } else if (recommendation.relation === 'ancestor') {
    applyStandardObservation(targetState, observed, confidenceDelta, 0.14, 0.34, 'indirect');
    if (observed < 0.5) {
      targetState.prerequisitePressure = round(clamp(targetState.prerequisitePressure + 0.18));
      targetState.recoveryPressure = round(targetState.recoveryPressure * 0.5);
      sourceState.prerequisitePressure = round(clamp(sourceState.prerequisitePressure + 0.16));
      boostAncestors(model, standardStates, sourceState.code, 0.2);
    } else {
      targetState.prerequisitePressure = round(targetState.prerequisitePressure * 0.55);
      targetState.recoveryPressure = round(clamp(targetState.recoveryPressure + 0.28));
      boostDescendants(model, standardStates, targetState.code, 0.18);
    }
  } else {
    applyStandardObservation(targetState, observed, confidenceDelta, 0.12, 0.28, 'indirect');
    if (observed > 0.75) {
      targetState.recoveryPressure = round(targetState.recoveryPressure * 0.54);
    } else {
      targetState.recoveryPressure = round(clamp(targetState.recoveryPressure + 0.14));
      boostAncestors(model, standardStates, targetState.code, 0.12);
    }
  }

  return [...changed];
}

function computeRecommendationState(
  model: DiagnosticModel,
  grade: string,
  standardStates: Map<string, StandardState>,
  skillStates: Map<string, SkillState>,
  lastRecommendation: DiagnosticCandidateView | null,
  followupContext: FollowupContext | null,
  recentTargetCodes: string[],
) {
  const gradeStandards = model.standardsByGrade.get(grade) || [];
  const activeStandards = new Set<string>(gradeStandards);
  const coverage = buildDomainCoverageContext(model, grade, standardStates);
  const recentTargetDomains = recentTargetCodes.map((code) =>
    domainKey(model.nodesByCode.get(code)?.domain),
  );

  for (const [code, state] of standardStates) {
    if (
      state.evidenceCount > 0 ||
      state.attention >= 0.12 ||
      state.prerequisitePressure >= 0.12 ||
      state.recoveryPressure >= 0.12
    ) {
      activeStandards.add(code);
    }
  }

  const leaderboard: DiagnosticCandidateView[] = [];
  const followupCandidates: DiagnosticCandidateView[] = [];

  for (const code of activeStandards) {
    const plan = model.plansByCode.get(code);
    if (!plan) continue;
    const targetState = getOrCreateStandardState(model, standardStates, code);
    const sameGrade = plan.focus_grade === grade;
    if (!sameGrade && targetState.attention < 0.12 && targetState.prerequisitePressure < 0.12) {
      continue;
    }

    const mode = determineMode(targetState, sameGrade);
    const targetNeed = standardNeedScore(
      plan,
      targetState,
      grade,
      lastRecommendation,
      coverage,
      recentTargetCodes,
      recentTargetDomains,
    );
    const domainCoverage = sameGrade
      ? coverage.domainCoverageGapByDomain.get(domainKey(plan.focus_domain)) || 0
      : 0;
    const scoreCandidates = (candidateList: AdaptiveDiagnosticCandidate[], candidateMode: AdaptiveModeId) => {
      for (const candidate of candidateList) {
        const sourceState = getOrCreateStandardState(
          model,
          standardStates,
          candidate.source_standard_code,
        );
        const skillState = getOrCreateSkillState(skillStates, candidate);
        const scored = candidateScore(
          targetNeed,
          domainCoverage,
          candidate,
          candidateMode,
          targetState,
          sourceState,
          skillState,
          lastRecommendation,
          recentTargetCodes,
        );

        const followupBias =
          followupContext &&
          code === followupContext.targetStandardCode &&
          candidateMode === followupContext.mode &&
          (!followupContext.relationPreference || candidate.relation === followupContext.relationPreference)
            ? 0.035
            : 0;

        const view = {
          ...candidate,
          target_standard_code: code,
          target_standard_grade: plan.focus_grade,
          target_standard_domain: plan.focus_domain,
          mode: candidateMode,
          selection_score: round(clamp(scored.selectionScore + followupBias)),
          influences: scored.influences,
          reasons: scored.reasons,
        } satisfies DiagnosticCandidateView;

        leaderboard.push(view);
        if (followupContext && code === followupContext.targetStandardCode && candidateMode === followupContext.mode) {
          followupCandidates.push(view);
        }
      }
    };

    scoreCandidates(plan.candidates[mode] || [], mode);

    if (followupContext && code === followupContext.targetStandardCode && followupContext.mode !== mode) {
      scoreCandidates(plan.candidates[followupContext.mode] || [], followupContext.mode);
    }
  }

  leaderboard.sort((a, b) => {
    if (b.selection_score !== a.selection_score) return b.selection_score - a.selection_score;
    if (a.target_standard_code !== b.target_standard_code) {
      return a.target_standard_code.localeCompare(b.target_standard_code, undefined, { numeric: true });
    }
    return (a.skill_code || a.skill_id).localeCompare(b.skill_code || b.skill_id, undefined, {
      numeric: true,
    });
  });

  const unique = new Map<string, DiagnosticCandidateView>();
  for (const candidate of leaderboard) {
    const key = `${candidate.target_standard_code}:${diagnosticSkillKey(candidate)}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }

  const deduped = [...unique.values()];
  let followupRecommendation: DiagnosticCandidateView | null = null;

  if (followupContext) {
    const followupUnique = new Map<string, DiagnosticCandidateView>();
    for (const candidate of followupCandidates) {
      const key = `${candidate.target_standard_code}:${diagnosticSkillKey(candidate)}`;
      if (!followupUnique.has(key)) followupUnique.set(key, candidate);
    }
    const followupDeduped = [...followupUnique.values()].sort((a, b) => {
      const leftPreferred = a.relation === followupContext.relationPreference ? 1 : 0;
      const rightPreferred = b.relation === followupContext.relationPreference ? 1 : 0;
      if (rightPreferred !== leftPreferred) return rightPreferred - leftPreferred;
      if (b.selection_score !== a.selection_score) return b.selection_score - a.selection_score;
      return (a.skill_code || a.skill_id).localeCompare(b.skill_code || b.skill_id, undefined, {
        numeric: true,
      });
    });
    const bestFollowup = followupDeduped[0] ?? null;
    const globalBest = deduped[0] ?? null;
    const targetRun = bestFollowup
      ? trailingTargetRun(recentTargetCodes, bestFollowup.target_standard_code)
      : 0;
    const withinScoreMargin =
      !globalBest ||
      !bestFollowup ||
      globalBest.selection_score - bestFollowup.selection_score <= FOLLOWUP_MAX_SCORE_GAP;
    const withinRunLimit = targetRun < MAX_CONSECUTIVE_TARGET_RUN;

    followupRecommendation =
      bestFollowup && withinScoreMargin && withinRunLimit ? bestFollowup : null;
  }

  const recommendation = followupRecommendation ?? deduped[0] ?? null;
  const curatedLeaderboard = recommendation
    ? [recommendation, ...deduped.filter((candidate) => !sameCandidate(candidate, recommendation))]
    : deduped;
  const topLeaderboard = curatedLeaderboard.slice(0, 8);

  return {
    recommendation,
    leaderboard: topLeaderboard,
    hypothesis: buildHypothesis(model, recommendation, standardStates),
    pathCodes: recommendation ? buildPathCodes(model, recommendation) : [],
    targetStandardCode: recommendation?.target_standard_code ?? null,
  } satisfies RecommendationState;
}

function summarizeSession(
  model: DiagnosticModel,
  grade: string,
  standardStates: Map<string, StandardState>,
  skillStates: Map<string, SkillState>,
) {
  let mastered = 0;
  let unmastered = 0;
  for (const state of skillStates.values()) {
    const status = classifyStatus(state.mastery, state.confidence);
    if (status === 'mastered') mastered += 1;
    else if (status === 'unmastered') unmastered += 1;
  }

  const totalRelevant = model.totalSkillCandidatesByGrade.get(grade) || 0;
  const unknown = Math.max(totalRelevant - mastered - unmastered, 0);

  return {
    current_step: 0,
    grade_standard_count: (model.standardsByGrade.get(grade) || []).length,
    surfaced_standard_count: [...standardStates.values()].filter(
      (state) =>
        state.evidenceCount > 0 ||
        state.attention >= 0.12 ||
        state.prerequisitePressure >= 0.12 ||
        state.recoveryPressure >= 0.12,
    ).length,
    mastered_skill_count: mastered,
    unmastered_skill_count: unmastered,
    unknown_skill_count: unknown,
  };
}

function serializeStandardStates(
  model: DiagnosticModel,
  grade: string,
  standardStates: Map<string, StandardState>,
) {
  const statusByCode: Record<string, DiagnosticStandardStatus> = {};
  const stateByCode: Record<string, StandardState> = {};

  const gradeCodes = new Set(model.standardsByGrade.get(grade) || []);
  for (const code of gradeCodes) {
    const state = getOrCreateStandardState(model, standardStates, code);
    statusByCode[code] = classifyStatus(state.mastery, state.confidence);
    stateByCode[code] = { ...state };
  }

  for (const [code, state] of standardStates) {
    if (!(code in statusByCode)) {
      statusByCode[code] = classifyStatus(state.mastery, state.confidence);
      stateByCode[code] = { ...state };
    }
  }

  return { statusByCode, stateByCode };
}

function serializeSkillStates(skillStates: Map<string, SkillState>) {
  const stateByKey: Record<string, DiagnosticSkillSnapshot> = {};
  for (const [key, state] of skillStates) {
    stateByKey[key] = {
      key,
      skill_id: state.skillId,
      source_standard_code: state.sourceStandardCode,
      mastery: state.mastery,
      confidence: state.confidence,
      evidence_count: state.evidenceCount,
      last_outcome: state.lastOutcome,
    };
  }
  return stateByKey;
}

export function createDiagnosticModel(
  graph: CoherenceGraph,
  adaptive: AdaptiveDiagnosticIndex,
): DiagnosticModel {
  const plansByCode = new Map<string, AdaptiveDiagnosticPlan>(
    Object.entries(adaptive.by_standard_code || {}),
  );

  const graphNodesByCode = new Map<string, CoherenceNode>();
  for (const node of graph.nodes) {
    if (!node.code) continue;
    if (node.level !== 'standard' && node.level !== 'substandard') continue;
    graphNodesByCode.set(node.code, node);
  }

  const nodesByCode = new Map<string, CoherenceNode>();
  for (const node of graph.nodes) {
    if (!node.code || !plansByCode.has(node.code)) continue;
    nodesByCode.set(node.code, node);
  }

  const standardsByGrade = new Map<string, string[]>();
  for (const [code, node] of nodesByCode) {
    if (!node.grade) continue;
    const row = standardsByGrade.get(node.grade);
    if (row) row.push(code);
    else standardsByGrade.set(node.grade, [code]);
  }

  for (const row of standardsByGrade.values()) {
    row.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  const { forward, reverse } = buildAdjacency(graph, nodesByCode);
  const { forward: graphForward, reverse: graphReverse } = buildAdjacency(graph, graphNodesByCode);
  const totalSkillCandidatesByGrade = new Map<string, number>();

  for (const [grade, codes] of standardsByGrade) {
    totalSkillCandidatesByGrade.set(
      grade,
      uniqueCandidateCount(codes.map((code) => plansByCode.get(code)).filter(Boolean) as AdaptiveDiagnosticPlan[]),
    );
  }

  const grades = [...standardsByGrade.keys()].sort((a, b) => gradeRank(a) - gradeRank(b));

  return {
    grades,
    nodesByCode,
    graphNodesByCode,
    plansByCode,
    standardsByGrade,
    forward,
    reverse,
    graphForward,
    graphReverse,
    pathCache: new Map<string, string[]>(),
    totalSkillCandidatesByGrade,
  };
}

export function simulateDiagnosticSession(
  model: DiagnosticModel,
  grade: string,
  outcomes: DiagnosticOutcome[],
  options: SimulationOptions = {},
): DiagnosticSessionView {
  const standardStates = new Map<string, StandardState>();
  const skillStates = new Map<string, SkillState>();
  const history: DiagnosticHistoryEntry[] = [];

  let lastRecommendation: DiagnosticCandidateView | null = null;
  let changedCodes: string[] = [];
  let followupContext: FollowupContext | null = null;
  let recentTargetCodes: string[] = [];

  for (let index = 0; index < outcomes.length; index += 1) {
    const current = computeRecommendationState(
      model,
      grade,
      standardStates,
      skillStates,
      lastRecommendation,
      followupContext,
      recentTargetCodes,
    );
    if (!current.recommendation) break;

    const outcome = outcomes[index];
    changedCodes = applyOutcome(
      model,
      standardStates,
      skillStates,
      current.recommendation,
      outcome,
    );
    const nextFollowupContext = buildFollowupContext(current.recommendation, outcome);
    const nextRecentTargetCodes = [...recentTargetCodes, current.recommendation.target_standard_code];

    const next = computeRecommendationState(
      model,
      grade,
      standardStates,
      skillStates,
      current.recommendation,
      nextFollowupContext,
      nextRecentTargetCodes,
    );

    history.push({
      step: index + 1,
      outcome,
      outcome_label: OUTCOME_META[outcome].label,
      candidate: current.recommendation,
      changed_codes: changedCodes,
      path_codes: current.pathCodes,
      surfaced_codes: collectSurfacedCodes(current, changedCodes),
      visible_codes: collectVisibleCodes(model, current, changedCodes),
      summary: buildHistorySummary(current.recommendation, outcome, next.recommendation),
      next_target_standard_code: next.targetStandardCode,
      next_skill_label: next.recommendation
        ? next.recommendation.skill_code || next.recommendation.skill_id
        : null,
    });

    lastRecommendation = current.recommendation;
    followupContext = nextFollowupContext;
    recentTargetCodes = nextRecentTargetCodes;
  }

  const current = computeRecommendationState(
    model,
    grade,
    standardStates,
    skillStates,
    lastRecommendation,
    followupContext,
    recentTargetCodes,
  );

  const { statusByCode, stateByCode } = serializeStandardStates(model, grade, standardStates);
  const skillStateByKey = serializeSkillStates(skillStates);
  const summary = summarizeSession(model, grade, standardStates, skillStates);
  summary.current_step = history.length;
  const sessionSeenCodes = new Set<string>(collectVisibleCodes(model, current, changedCodes));
  for (const entry of history) {
    for (const code of entry.visible_codes) sessionSeenCodes.add(code);
  }

  const branchPreview =
    options.includeBranchPreview === false
      ? []
      : buildBranchPreview(
          model,
          grade,
          standardStates,
          skillStates,
          current.recommendation,
          recentTargetCodes,
        );

  return {
    grade,
    current_recommendation: current.recommendation,
    current_hypothesis: current.hypothesis,
    current_path_codes: current.pathCodes,
    current_target_standard_code: current.targetStandardCode,
    leaderboard: current.leaderboard,
    branch_preview: branchPreview,
    history,
    summary,
    status_by_code: statusByCode,
    standard_state_by_code: stateByCode,
    skill_state_by_key: skillStateByKey,
    changed_codes: history.at(-1)?.changed_codes || changedCodes,
    session_seen_codes: [...sessionSeenCodes],
  };
}

export function diagnosticOutcomeMeta(outcome: DiagnosticOutcome) {
  return OUTCOME_META[outcome];
}

export function diagnosticOutcomeOptions() {
  return OUTCOME_ORDER.map((outcome) => ({
    id: outcome,
    ...OUTCOME_META[outcome],
  }));
}
