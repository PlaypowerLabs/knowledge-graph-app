import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

const DEFAULT_MAPPING_PATH =
  '/Users/malaypatel/.codex/worktrees/be9d/IXL-question-scrapper/data/diagnostic/ixl_ccss_mapping.jsonl';
const DEFAULT_CATALOG_PATH =
  '/Users/malaypatel/.codex/worktrees/be9d/IXL-question-scrapper/data/diagnostic/ixl_skill_catalog.jsonl';
const DEFAULT_QUESTION_BANK_PATH =
  '/Users/malaypatel/.codex/worktrees/be9d/IXL-question-scrapper/data/diagnostic/ixl_question_bank.jsonl';

const DEFAULT_VIEWER_BASE_URL = 'http://localhost:4317/viewer/index.html';

function resolveSources() {
  return {
    mapping: process.env.IXL_CCSS_MAPPING_PATH || DEFAULT_MAPPING_PATH,
    catalog: process.env.IXL_SKILL_CATALOG_PATH || DEFAULT_CATALOG_PATH,
    questionBank:
      process.env.IXL_QUESTION_BANK_PATH || DEFAULT_QUESTION_BANK_PATH,
  };
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] == null) process.env[key] = stripQuotes(value);
  }
}

function loadRepoEnv() {
  loadEnvFile(path.join(REPO, '.env'));
  loadEnvFile(path.join(REPO, '.env.local'));
}

function resolveViewerBaseUrl() {
  loadRepoEnv();
  return process.env.IXL_VIEWER_BASE_URL || DEFAULT_VIEWER_BASE_URL;
}

async function* lines(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line) yield line;
  }
}

function normalizeText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compareMaybeNumbers(a, b) {
  const aNum = normalizeNumber(a);
  const bNum = normalizeNumber(b);
  if (aNum != null && bNum != null) return aNum - bNum;
  if (aNum != null) return -1;
  if (bNum != null) return 1;
  return 0;
}

function sourceFileLabel(sourceFile) {
  const basename = sourceFile.split('/').pop() || sourceFile;
  const withoutExt = basename.replace(/\.json$/i, '');
  const readable = withoutExt.replace(/^[^_]+__/, '').replace(/-/g, ' ');
  return readable.replace(/\s+/g, ' ').trim() || basename;
}

function buildLevelLabel(level) {
  if (
    level.user_facing_level != null &&
    level.num_levels != null &&
    level.num_levels > 1
  ) {
    return `Level ${level.user_facing_level} of ${level.num_levels}`;
  }
  if (level.user_facing_level != null)
    return `Level ${level.user_facing_level}`;
  if (level.level_variant != null) return `Variant ${level.level_variant}`;
  return sourceFileLabel(level.source_file);
}

function compareLevels(a, b) {
  const byVariant = compareMaybeNumbers(a.level_variant, b.level_variant);
  if (byVariant) return byVariant;
  const byUserLevel = compareMaybeNumbers(
    a.user_facing_level,
    b.user_facing_level
  );
  if (byUserLevel) return byUserLevel;
  return a.source_file.localeCompare(b.source_file, undefined, {
    numeric: true,
  });
}

function compareSkills(a, b) {
  return (a.skill_code || '').localeCompare(b.skill_code || '', undefined, {
    numeric: true,
  });
}

export async function buildCoherenceIxl({ outFile, validStandardCodes }) {
  const sources = resolveSources();
  const viewerBaseUrl = resolveViewerBaseUrl();
  const missing = Object.entries(sources)
    .filter(([, filePath]) => !fs.existsSync(filePath))
    .map(([name, filePath]) => `${name}: ${filePath}`);

  if (missing.length) {
    console.error('  IXL sources missing; writing empty artifact.');
    for (const miss of missing) console.error(`    ${miss}`);
    const empty = {
      generatedAt: new Date().toISOString(),
      viewer_base_url: viewerBaseUrl,
      source_paths: sources,
      by_standard_code: {},
      stats: {
        standard_count: 0,
        skill_count: 0,
        level_count: 0,
      },
    };
    fs.writeFileSync(outFile, JSON.stringify(empty));
    return empty;
  }

  console.error('  Loading IXL skill catalog...');
  const catalogBySkillId = new Map();
  for await (const line of lines(sources.catalog)) {
    const rec = JSON.parse(line);
    const skillId = normalizeText(rec.skill_id);
    if (!skillId) continue;
    catalogBySkillId.set(skillId, {
      skill_id: skillId,
      skill_name: normalizeText(rec.skill_name),
      skill_code: normalizeText(rec.skill_code),
      permacode: normalizeText(rec.permacode),
      question_count: normalizeNumber(rec.question_count),
      question_file_count: normalizeNumber(rec.question_file_count),
      explicit_level_variants: Array.isArray(rec.explicit_level_variants)
        ? rec.explicit_level_variants
            .map(normalizeNumber)
            .filter((v) => v != null)
        : [],
      num_levels_seen: Array.isArray(rec.num_levels_seen)
        ? rec.num_levels_seen.map(normalizeNumber).filter((v) => v != null)
        : [],
      grades: Array.isArray(rec.grades) ? rec.grades.map(String) : [],
    });
  }
  console.error(`    ${catalogBySkillId.size} skills in catalog`);

  console.error('  Aggregating question-bank files by skill...');
  const levelsBySkillId = new Map();
  for await (const line of lines(sources.questionBank)) {
    const rec = JSON.parse(line);
    const skillId = normalizeText(rec.skill_id);
    const sourceFile = normalizeText(rec.source_file);
    if (!skillId || !sourceFile) continue;

    let filesForSkill = levelsBySkillId.get(skillId);
    if (!filesForSkill) {
      filesForSkill = new Map();
      levelsBySkillId.set(skillId, filesForSkill);
    }

    let level = filesForSkill.get(sourceFile);
    if (!level) {
      level = {
        label: '',
        level_variant: normalizeNumber(rec.level_variant),
        user_facing_level: normalizeNumber(rec.user_facing_level),
        num_levels: normalizeNumber(rec.num_levels),
        source_file: sourceFile,
        question_count: 0,
      };
      filesForSkill.set(sourceFile, level);
    }

    level.question_count += 1;
    if (level.level_variant == null)
      level.level_variant = normalizeNumber(rec.level_variant);
    if (level.user_facing_level == null) {
      level.user_facing_level = normalizeNumber(rec.user_facing_level);
    }
    if (level.num_levels == null)
      level.num_levels = normalizeNumber(rec.num_levels);
  }
  console.error(
    `    ${levelsBySkillId.size} skills with at least one scraped file`
  );

  console.error('  Joining CCSS standards to IXL skills...');
  const byStandardCode = new Map();
  for await (const line of lines(sources.mapping)) {
    const rec = JSON.parse(line);
    const standardCode = normalizeText(rec.ccss_standard_code);
    const skillId = normalizeText(rec.ixl_skill_id);
    if (!standardCode || !skillId) continue;
    if (validStandardCodes && !validStandardCodes.has(standardCode)) continue;

    let standard = byStandardCode.get(standardCode);
    if (!standard) {
      standard = {
        standard_code: standardCode,
        standard_text: normalizeText(rec.ccss_standard_text),
        skills: new Map(),
      };
      byStandardCode.set(standardCode, standard);
    }
    if (standard.skills.has(skillId)) continue;

    const catalog = catalogBySkillId.get(skillId);
    const levelMap = levelsBySkillId.get(skillId);
    const levels = levelMap
      ? [...levelMap.values()]
          .map((level) => {
            const payload = {
              ...level,
              label: '',
              viewer_url: `${viewerBaseUrl}?file=${encodeURIComponent(
                'output/' + level.source_file
              )}&question=0`,
            };
            payload.label = buildLevelLabel(payload);
            return payload;
          })
          .sort(compareLevels)
      : [];

    const observedQuestionCount = levels.reduce(
      (sum, level) => sum + level.question_count,
      0
    );
    const skill = {
      skill_id: skillId,
      skill_name:
        normalizeText(rec.ixl_skill_name) || catalog?.skill_name || null,
      skill_code:
        normalizeText(rec.ixl_skill_code) || catalog?.skill_code || null,
      permacode: normalizeText(rec.ixl_permacode) || catalog?.permacode || null,
      ixl_skill_url: normalizeText(rec.ixl_skill_url),
      num_levels: levels.length,
      question_file_count: levels.length || catalog?.question_file_count || 0,
      question_count: observedQuestionCount || catalog?.question_count || 0,
      levels,
    };
    standard.skills.set(skillId, skill);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    viewer_base_url: viewerBaseUrl,
    source_paths: sources,
    by_standard_code: {},
    stats: {
      standard_count: 0,
      skill_count: 0,
      level_count: 0,
    },
  };

  let skillCount = 0;
  let levelCount = 0;
  const sortedStandards = [...byStandardCode.values()].sort((a, b) =>
    a.standard_code.localeCompare(b.standard_code, undefined, { numeric: true })
  );

  for (const standard of sortedStandards) {
    const skills = [...standard.skills.values()].sort(compareSkills);
    skillCount += skills.length;
    levelCount += skills.reduce((sum, skill) => sum + skill.levels.length, 0);
    output.by_standard_code[standard.standard_code] = {
      standard_code: standard.standard_code,
      standard_text: standard.standard_text,
      skill_count: skills.length,
      skills,
    };
  }

  output.stats.standard_count = sortedStandards.length;
  output.stats.skill_count = skillCount;
  output.stats.level_count = levelCount;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output));
  console.error(
    `    ${output.stats.standard_count} standards, ${output.stats.skill_count} skills, ${output.stats.level_count} level links`
  );
  return output;
}
