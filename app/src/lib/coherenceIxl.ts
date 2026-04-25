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

export function findIxlStandard(
  index: CoherenceIxlIndex,
  standardCode: string | null | undefined,
) {
  if (!standardCode) return null;
  return index.by_standard_code[standardCode] ?? null;
}

export function findIxlSkill(
  index: CoherenceIxlIndex,
  standardCode: string | null | undefined,
  skillId: string | null | undefined,
) {
  if (!standardCode || !skillId) return null;
  const standard = index.by_standard_code[standardCode];
  if (!standard) return null;
  return standard.skills.find((skill) => skill.skill_id === skillId) ?? null;
}

export function buildIxlQuestionUrl(level: Pick<CoherenceIxlLevel, 'viewer_url' | 'source_file'>) {
  try {
    const viewerUrl = new URL(level.viewer_url);
    const file = viewerUrl.searchParams.get('file');
    const question = viewerUrl.searchParams.get('question') || '0';
    const questionUrl = new URL('/question/', `${viewerUrl.protocol}//${viewerUrl.host}`);
    if (file) questionUrl.searchParams.set('file', file);
    else {
      const fallbackFile = level.source_file.startsWith('output/')
        ? level.source_file
        : `output/${level.source_file}`;
      questionUrl.searchParams.set('file', fallbackFile);
    }
    questionUrl.searchParams.set('question', question);
    return questionUrl.toString();
  } catch {
    const file = level.source_file.startsWith('output/')
      ? level.source_file
      : `output/${level.source_file}`;
    return `http://localhost:4317/question/?file=${encodeURIComponent(file)}&question=0`;
  }
}

export function buildIxlViewerUrl(level: Pick<CoherenceIxlLevel, 'viewer_url' | 'source_file'>) {
  try {
    const viewerUrl = new URL(level.viewer_url);
    const file = viewerUrl.searchParams.get('file');
    const question = viewerUrl.searchParams.get('question') || '0';
    const normalizedViewerUrl = new URL('/viewer/index.html', `${viewerUrl.protocol}//${viewerUrl.host}`);
    if (file) normalizedViewerUrl.searchParams.set('file', file);
    else {
      const fallbackFile = level.source_file.startsWith('output/')
        ? level.source_file
        : `output/${level.source_file}`;
      normalizedViewerUrl.searchParams.set('file', fallbackFile);
    }
    normalizedViewerUrl.searchParams.set('question', question);
    return normalizedViewerUrl.toString();
  } catch {
    const file = level.source_file.startsWith('output/')
      ? level.source_file
      : `output/${level.source_file}`;
    return `http://localhost:4317/viewer/index.html?file=${encodeURIComponent(file)}&question=0`;
  }
}

export function formatIxlLevelMeta(level: CoherenceIxlLevel): string {
  const pieces: string[] = [];
  if (level.user_facing_level != null) pieces.push(`Level ${level.user_facing_level}`);
  if (level.level_variant != null) pieces.push(`variant ${level.level_variant}`);
  if (level.question_count) {
    pieces.push(`${level.question_count} question${level.question_count === 1 ? '' : 's'}`);
  }
  return pieces.join(' · ');
}
