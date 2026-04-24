export type CoherenceIxlLevel = {
  label: string;
  level_variant: number | null;
  user_facing_level: number | null;
  num_levels: number | null;
  source_file: string;
  question_count: number;
  viewer_url: string;
};

export type CoherenceIxlSkill = {
  skill_id: string;
  skill_name: string | null;
  skill_code: string | null;
  permacode: string | null;
  ixl_skill_url: string | null;
  num_levels: number;
  question_file_count: number;
  question_count: number;
  levels: CoherenceIxlLevel[];
};

export type CoherenceIxlStandard = {
  standard_code: string;
  standard_text: string | null;
  skill_count: number;
  skills: CoherenceIxlSkill[];
};

export type CoherenceIxlIndex = {
  generatedAt: string;
  viewer_base_url: string;
  source_paths: {
    mapping: string;
    catalog: string;
    questionBank: string;
  };
  by_standard_code: Record<string, CoherenceIxlStandard>;
  stats: {
    standard_count: number;
    skill_count: number;
    level_count: number;
  };
};

export function formatIxlLevelMeta(level: CoherenceIxlLevel): string {
  const pieces: string[] = [];
  if (level.user_facing_level != null) pieces.push(`Level ${level.user_facing_level}`);
  if (level.level_variant != null) pieces.push(`variant ${level.level_variant}`);
  if (level.question_count) {
    pieces.push(`${level.question_count} question${level.question_count === 1 ? '' : 's'}`);
  }
  return pieces.join(' · ');
}
