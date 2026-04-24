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

export type DiagnosticOutcome = (typeof OUTCOME_ORDER)[number];
export type DiagnosticStandardStatus = 'mastered' | 'unmastered' | 'mixed' | 'unknown';

export type DiagnosticModel = {
  grades: string[];
  nodesByCode: Map<string, CoherenceNode>;
  plansByCode: Map<string, AdaptiveDiagnosticPlan>;
  standardsByGrade: Map<string, string[]>;
  forward: Map<string, string[]>;
  reverse: Map<string, string[]>;
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
  };
  reasons: string[];
};

export type DiagnosticPreviewEntry = {
  outcome: DiagnosticOutcome;
  label: string;
  next_target_standard_code: string | null;
  skills: DiagnosticCandidateView[];
};

export type DiagnosticHistoryEntry = {
  step: number;
  outcome: DiagnosticOutcome;
  outcome_label: string;
  candidate: DiagnosticCandidateView;
  changed_codes: string[];
  path_codes: string[];
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
  branch_preview: DiagnosticPreviewEntry[];
  history: DiagnosticHistoryEntry[];
  summary: DiagnosticSessionSummary;
  status_by_code: Record<string, DiagnosticStandardStatus>;
  standard_state_by_code: Record<string, StandardState>;
  changed_codes: string[];
};

type RecommendationState = {
  recommendation: DiagnosticCandidateView | null;
  leaderboard: DiagnosticCandidateView[];
  hypothesis: string | null;
  pathCodes: string[];
  targetStandardCode: string | null;
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

function skillKey(candidate: Pick<AdaptiveDiagnosticCandidate, 'source_standard_code' | 'skill_id'>) {
  return `${candidate.source_standard_code}:${candidate.skill_id}`;
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
        keys.add(skillKey(candidate));
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
  const key = skillKey(candidate);
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

function standardNeedScore(
  plan: AdaptiveDiagnosticPlan,
  state: StandardState,
  grade: string,
  lastRecommendation: DiagnosticCandidateView | null,
) {
  const sameGrade = plan.focus_grade === grade;
  const unknown = state.evidenceCount === 0 ? 1 : 0;
  const uncertainty = 1 - state.confidence;
  const weakness = clamp((0.5 - state.mastery) / 0.5);
  const followup = Math.max(state.attention, state.prerequisitePressure, state.recoveryPressure);
  const impact = plan.descendant_standard_count ? clamp(plan.descendant_standard_count / 12) : 0;
  const repeatPenalty =
    lastRecommendation?.target_standard_code === plan.focus_standard_code && followup < 0.2 ? 0.08 : 0;

  return round(
    clamp(
      (sameGrade ? 0.22 : 0.08) +
        0.24 * unknown +
        0.2 * uncertainty +
        0.16 * weakness +
        0.12 * followup +
        0.1 * impact -
        repeatPenalty,
    ),
  );
}

function candidateScore(
  targetNeed: number,
  candidate: AdaptiveDiagnosticCandidate,
  mode: AdaptiveModeId,
  targetState: StandardState,
  sourceState: StandardState,
  skillState: SkillState,
  lastRecommendation: DiagnosticCandidateView | null,
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
    lastRecommendation && skillKey(lastRecommendation) === skillKey(candidate) ? 0.12 : 0;

  const selectionScore = round(
    clamp(
      0.38 * targetNeed +
        0.3 * candidate.score +
        0.16 * uncertaintyGain +
        0.1 * followupPressure +
        0.06 * sourceSignal -
        repeatPenalty,
    ),
  );

  const influences = {
    target_need: targetNeed,
    artifact_priority: candidate.score,
    uncertainty_gain: uncertaintyGain,
    followup_pressure: followupPressure,
    source_signal: sourceSignal,
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

  sourceState.mastery = updatePosterior(
    sourceState.mastery,
    observed,
    recommendation.relation === 'focus' ? 0.42 : 0.35,
  );
  sourceState.confidence = round(clamp(sourceState.confidence + confidenceDelta * 0.82));
  sourceState.evidenceCount += 1;
  sourceState.attention = round(clamp(sourceState.attention + 0.18));
  changed.add(sourceState.code);

  targetState.attention = round(clamp(targetState.attention + 0.2));
  if (targetState.code !== sourceState.code) changed.add(targetState.code);

  if (recommendation.relation === 'focus') {
    targetState.mastery = updatePosterior(targetState.mastery, observed, 0.38);
    targetState.confidence = round(clamp(targetState.confidence + confidenceDelta * 0.7));
    targetState.evidenceCount += 1;

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
    targetState.mastery = updatePosterior(targetState.mastery, observed, 0.14);
    targetState.confidence = round(clamp(targetState.confidence + confidenceDelta * 0.34));
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
    targetState.mastery = updatePosterior(targetState.mastery, observed, 0.12);
    targetState.confidence = round(clamp(targetState.confidence + confidenceDelta * 0.28));
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
) {
  const gradeStandards = model.standardsByGrade.get(grade) || [];
  const activeStandards = new Set<string>(gradeStandards);

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

  for (const code of activeStandards) {
    const plan = model.plansByCode.get(code);
    if (!plan) continue;
    const targetState = getOrCreateStandardState(model, standardStates, code);
    const sameGrade = plan.focus_grade === grade;
    if (!sameGrade && targetState.attention < 0.12 && targetState.prerequisitePressure < 0.12) {
      continue;
    }

    const mode = determineMode(targetState, sameGrade);
    const targetNeed = standardNeedScore(plan, targetState, grade, lastRecommendation);
    const candidates = plan.candidates[mode] || [];
    for (const candidate of candidates) {
      const sourceState = getOrCreateStandardState(model, standardStates, candidate.source_standard_code);
      const skillState = getOrCreateSkillState(skillStates, candidate);
      const scored = candidateScore(
        targetNeed,
        candidate,
        mode,
        targetState,
        sourceState,
        skillState,
        lastRecommendation,
      );

      leaderboard.push({
        ...candidate,
        target_standard_code: code,
        target_standard_grade: plan.focus_grade,
        target_standard_domain: plan.focus_domain,
        mode,
        selection_score: scored.selectionScore,
        influences: scored.influences,
        reasons: scored.reasons,
      });
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
    const key = `${candidate.target_standard_code}:${skillKey(candidate)}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }

  const deduped = [...unique.values()].slice(0, 8);
  const recommendation = deduped[0] ?? null;

  return {
    recommendation,
    leaderboard: deduped,
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

export function createDiagnosticModel(
  graph: CoherenceGraph,
  adaptive: AdaptiveDiagnosticIndex,
): DiagnosticModel {
  const plansByCode = new Map<string, AdaptiveDiagnosticPlan>(
    Object.entries(adaptive.by_standard_code || {}),
  );

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
    plansByCode,
    standardsByGrade,
    forward,
    reverse,
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

  for (let index = 0; index < outcomes.length; index += 1) {
    const current = computeRecommendationState(
      model,
      grade,
      standardStates,
      skillStates,
      lastRecommendation,
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

    const next = computeRecommendationState(
      model,
      grade,
      standardStates,
      skillStates,
      current.recommendation,
    );

    history.push({
      step: index + 1,
      outcome,
      outcome_label: OUTCOME_META[outcome].label,
      candidate: current.recommendation,
      changed_codes: changedCodes,
      path_codes: current.pathCodes,
      summary: buildHistorySummary(current.recommendation, outcome, next.recommendation),
      next_target_standard_code: next.targetStandardCode,
      next_skill_label: next.recommendation
        ? next.recommendation.skill_code || next.recommendation.skill_id
        : null,
    });

    lastRecommendation = current.recommendation;
  }

  const current = computeRecommendationState(
    model,
    grade,
    standardStates,
    skillStates,
    lastRecommendation,
  );

  const { statusByCode, stateByCode } = serializeStandardStates(model, grade, standardStates);
  const summary = summarizeSession(model, grade, standardStates, skillStates);
  summary.current_step = history.length;

  const branchPreview =
    options.includeBranchPreview === false || !current.recommendation
      ? []
      : OUTCOME_ORDER.map((outcome) => {
          const preview = simulateDiagnosticSession(
            model,
            grade,
            [...outcomes, outcome],
            { includeBranchPreview: false },
          );
          return {
            outcome,
            label: OUTCOME_META[outcome].label,
            next_target_standard_code: preview.current_target_standard_code,
            skills: preview.leaderboard.slice(0, 2),
          } satisfies DiagnosticPreviewEntry;
        });

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
    changed_codes: history.at(-1)?.changed_codes || changedCodes,
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
