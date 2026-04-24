export type AdaptiveModeId = 'baseline' | 'prerequisite' | 'recovery';

export type AdaptiveModeMeta = {
  id: AdaptiveModeId;
  label: string;
  description: string;
};

export type AdaptiveDiagnosticCandidate = {
  skill_id: string;
  skill_code: string | null;
  skill_name: string | null;
  question_file_count: number;
  num_levels: number;
  question_count: number;
  source_standard_code: string;
  source_standard_grade: string | null;
  source_standard_domain: string | null;
  relation: 'focus' | 'ancestor' | 'descendant';
  distance: number;
  score: number;
  score_breakdown: {
    target_alignment: number;
    observability: number;
    graph_support: number;
    cross_grade_relevance: number;
  };
  explanation: string;
};

export type AdaptivePrerequisiteStandard = {
  standard_code: string;
  grade: string | null;
  domain: string | null;
  distance: number;
  skill_count: number;
  graph_support: number;
  cross_grade_gap: number;
};

export type AdaptiveDiagnosticPlan = {
  focus_standard_code: string;
  focus_grade: string | null;
  focus_domain: string | null;
  direct_skill_count: number;
  ancestor_standard_count: number;
  descendant_standard_count: number;
  prerequisite_standards: AdaptivePrerequisiteStandard[];
  candidates: Record<AdaptiveModeId, AdaptiveDiagnosticCandidate[]>;
};

export type AdaptiveDiagnosticIndex = {
  generatedAt: string;
  score_version: string;
  modes: AdaptiveModeMeta[];
  by_standard_code: Record<string, AdaptiveDiagnosticPlan>;
  stats: {
    standard_count: number;
    standards_with_direct_skills: number;
    candidate_count: number;
  };
};

export function formatAdaptivePercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
