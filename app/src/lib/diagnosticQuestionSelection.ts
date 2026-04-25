import type { AdaptiveModeId } from '@/lib/coherenceAdaptive';
import type { CoherenceIxlLevel, CoherenceIxlSkill } from '@/lib/coherenceIxl';
import {
  diagnosticSkillKey,
  type DiagnosticCandidateView,
  type DiagnosticOutcome,
  type DiagnosticSkillSnapshot,
} from '@/lib/diagnosticEngine';

type LevelSelectionContext = {
  relation: 'focus' | 'ancestor' | 'descendant';
  mode: AdaptiveModeId;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function levelSortValue(level: CoherenceIxlLevel) {
  if (level.level_variant != null) return level.level_variant;
  if (level.user_facing_level != null) return level.user_facing_level - 1;
  return Number.MAX_SAFE_INTEGER;
}

export function sortIxlLevels(levels: CoherenceIxlLevel[]) {
  return [...levels].sort((a, b) => {
    const levelDiff = levelSortValue(a) - levelSortValue(b);
    if (levelDiff !== 0) return levelDiff;
    return a.source_file.localeCompare(b.source_file, undefined, { numeric: true });
  });
}

export function chooseDiagnosticLevel(
  skill: CoherenceIxlSkill,
  context: LevelSelectionContext,
  state: DiagnosticSkillSnapshot | null,
) {
  const ordered = sortIxlLevels(skill.levels);
  if (!ordered.length) return null;
  if (ordered.length === 1) return ordered[0];

  let targetRatio = 0.46;
  if (state && state.evidence_count > 0) {
    const masteryRatio = clamp(state.mastery);
    const confidencePull = clamp(state.confidence) * 0.2;
    targetRatio = 0.18 + masteryRatio * 0.64;
    targetRatio = targetRatio * (0.8 + confidencePull) + 0.5 * (0.2 - confidencePull);
  }

  if (context.mode === 'prerequisite' || context.relation === 'ancestor') {
    targetRatio -= 0.18;
  } else if (context.mode === 'recovery' || context.relation === 'descendant') {
    targetRatio += 0.14;
  }

  switch (state?.last_outcome as DiagnosticOutcome | null) {
    case 'correct':
      targetRatio += 0.12;
      break;
    case 'partial':
      targetRatio += 0.02;
      break;
    case 'unsure':
      targetRatio -= 0.12;
      break;
    case 'incorrect':
      targetRatio -= 0.2;
      break;
    default:
      break;
  }

  const index = Math.round(clamp(targetRatio) * (ordered.length - 1));
  return ordered[index] ?? ordered[0];
}

export function selectCurrentDiagnosticLevel(
  skill: CoherenceIxlSkill | null,
  candidate: Pick<DiagnosticCandidateView, 'source_standard_code' | 'skill_id' | 'relation' | 'mode'> | null,
  skillStateByKey: Record<string, DiagnosticSkillSnapshot> | null | undefined,
) {
  if (!skill || !candidate) return null;

  return chooseDiagnosticLevel(
    skill,
    {
      relation: candidate.relation,
      mode: candidate.mode,
    },
    skillStateByKey?.[diagnosticSkillKey(candidate)] ?? null,
  );
}
