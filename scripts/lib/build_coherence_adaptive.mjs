import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_CANDIDATES = 10;
const DEFAULT_MAX_PREREQUISITES = 8;

const MODE_META = [
  {
    id: 'baseline',
    label: 'Baseline Probe',
    description:
      'Before the learner model has real evidence, the engine starts with skills closest to the focus standard and prefers skills with enough observed files and levels to measure cleanly.',
  },
  {
    id: 'prerequisite',
    label: 'Prerequisite Trace',
    description:
      'If the focus standard looks weak, the engine moves backward through prerequisite standards and prioritizes skills that are graph-close, cross-grade relevant, and well covered in the scraped bank.',
  },
  {
    id: 'recovery',
    label: 'Recovery Check',
    description:
      'After a prerequisite has been practiced or evidence is mixed, the engine rechecks focus-standard skills and immediate downstream skills to see whether understanding transfers forward.',
  },
];

const MODE_ORDER = MODE_META.map((mode) => mode.id);

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function gradeRank(grade) {
  if (grade == null) return 99;
  if (grade === 'K') return 0;
  if (grade === 'HS') return 9;
  const parsed = Number(grade);
  return Number.isFinite(parsed) ? parsed : 99;
}

function normalizeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSkill(skill) {
  const questionFileCount = normalizeNumber(skill.question_file_count);
  const numLevels = normalizeNumber(skill.num_levels || skill.levels?.length || questionFileCount);
  const questionCount = normalizeNumber(skill.question_count);
  return {
    skill_id: skill.skill_id,
    skill_code: skill.skill_code || null,
    skill_name: skill.skill_name || null,
    question_file_count: questionFileCount,
    num_levels: numLevels,
    question_count: questionCount,
  };
}

function observabilityScore(skill) {
  const fileComponent = Math.min(skill.question_file_count, 5) / 5;
  const levelComponent = Math.min(skill.num_levels, 5) / 5;
  const questionComponent = Math.min(skill.question_count, 150) / 150;
  return round(0.45 * fileComponent + 0.35 * levelComponent + 0.2 * questionComponent);
}

function buildAdjacency(graph, nodesByCode) {
  const idToCode = new Map();
  for (const node of graph.nodes) {
    if (node.code && nodesByCode.has(node.code)) idToCode.set(node.id, node.code);
  }

  const forward = new Map();
  const reverse = new Map();
  for (const edge of graph.edges) {
    if (edge.label !== 'buildsTowards') continue;
    const sourceCode = idToCode.get(edge.source);
    const targetCode = idToCode.get(edge.target);
    if (!sourceCode || !targetCode) continue;
    if (!forward.has(sourceCode)) forward.set(sourceCode, []);
    if (!reverse.has(targetCode)) reverse.set(targetCode, []);
    forward.get(sourceCode).push(targetCode);
    reverse.get(targetCode).push(sourceCode);
  }
  return { forward, reverse };
}

function distancesFrom(start, adjacency) {
  const seen = new Map();
  const queue = [{ code: start, distance: 0 }];
  seen.set(start, 0);

  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current.code) || []) {
      if (seen.has(next)) continue;
      const nextDistance = current.distance + 1;
      seen.set(next, nextDistance);
      queue.push({ code: next, distance: nextDistance });
    }
  }

  seen.delete(start);
  return seen;
}

function gradeGapScore(focusNode, sourceNode) {
  const focusRank = gradeRank(focusNode.grade);
  const sourceRank = gradeRank(sourceNode.grade);
  if (focusRank === 99 || sourceRank === 99) return 0;
  return round(Math.min(Math.max(focusRank - sourceRank, 0) / 5, 1));
}

function distanceAlignment(distance) {
  return round(1 / (distance + 1));
}

function graphSupportScore(sourceCode, descendantCounts, maxDescendants) {
  if (!maxDescendants) return 0;
  return round((descendantCounts.get(sourceCode) || 0) / maxDescendants);
}

function scoreCandidate(mode, relation, metrics) {
  const roleScore =
    mode === 'recovery'
      ? relation === 'focus'
        ? 1
        : relation === 'descendant'
          ? 0.82
          : 0.65
      : relation === 'focus'
        ? 1
        : 0.7;

  if (mode === 'baseline') {
    return round(
      0.45 * roleScore +
        0.25 * metrics.target_alignment +
        0.2 * metrics.observability +
        0.1 * metrics.graph_support,
    );
  }

  if (mode === 'prerequisite') {
    return round(
      0.35 * metrics.target_alignment +
        0.25 * metrics.cross_grade_relevance +
        0.22 * metrics.observability +
        0.18 * metrics.graph_support,
    );
  }

  return round(
    0.34 * roleScore +
      0.26 * metrics.target_alignment +
      0.24 * metrics.observability +
      0.16 * metrics.graph_support,
  );
}

function buildExplanation(mode, relation, candidate) {
  const source = candidate.source_standard_code;
  const files = `${candidate.question_file_count} file${candidate.question_file_count === 1 ? '' : 's'}`;
  const levels = `${candidate.num_levels} level${candidate.num_levels === 1 ? '' : 's'}`;

  if (mode === 'baseline') {
    if (relation === 'focus') {
      return `Direct skill on ${source}; strong starting probe because it measures the focus standard with ${files} across ${levels}.`;
    }
    return `Fallback probe from prerequisite ${source}; useful when the focus standard has sparse direct coverage or the model needs cleaner evidence.`;
  }

  if (mode === 'prerequisite') {
    return `Prerequisite probe from ${source}; close in the dependency graph and backed by ${files}, which makes it a strong root-cause check.`;
  }

  if (relation === 'descendant') {
    return `Transfer check on downstream standard ${source}; used after new evidence to see whether understanding carries forward.`;
  }
  return `Recheck on the focus standard after prerequisite evidence changes; ${files} and ${levels} make it a stable recovery signal.`;
}

function buildCandidate({
  mode,
  relation,
  distance,
  focusNode,
  sourceNode,
  skill,
  descendantCounts,
  maxDescendants,
}) {
  const metrics = {
    target_alignment: distanceAlignment(distance),
    observability: observabilityScore(skill),
    graph_support: graphSupportScore(sourceNode.code, descendantCounts, maxDescendants),
    cross_grade_relevance:
      relation === 'ancestor' ? gradeGapScore(focusNode, sourceNode) : 0,
  };

  const candidate = {
    ...skill,
    source_standard_code: sourceNode.code,
    source_standard_grade: sourceNode.grade,
    source_standard_domain: sourceNode.domain,
    relation,
    distance,
    score: scoreCandidate(mode, relation, metrics),
    score_breakdown: metrics,
  };

  return {
    ...candidate,
    explanation: buildExplanation(mode, relation, candidate),
  };
}

function sortCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.distance !== b.distance) return a.distance - b.distance;
  return (a.skill_code || '').localeCompare(b.skill_code || '', undefined, { numeric: true });
}

function buildModeCandidates({
  mode,
  focusNode,
  directSkills,
  ancestorDistances,
  descendantDistances,
  nodesByCode,
  skillsByStandardCode,
  descendantCounts,
  maxDescendants,
  maxCandidatesPerMode,
}) {
  const candidates = [];

  const pushSkills = (skills, relation, distance, sourceNode) => {
    for (const skill of skills) {
      candidates.push(
        buildCandidate({
          mode,
          relation,
          distance,
          focusNode,
          sourceNode,
          skill,
          descendantCounts,
          maxDescendants,
        }),
      );
    }
  };

  if (mode === 'baseline') {
    pushSkills(directSkills, 'focus', 0, focusNode);
    const sortedAncestors = [...ancestorDistances.entries()].sort((a, b) => a[1] - b[1]);
    for (const [code, distance] of sortedAncestors) {
      const skills = skillsByStandardCode.get(code) || [];
      if (!skills.length) continue;
      const sourceNode = nodesByCode.get(code);
      if (!sourceNode) continue;
      pushSkills(skills, 'ancestor', distance, sourceNode);
    }
  } else if (mode === 'prerequisite') {
    const sortedAncestors = [...ancestorDistances.entries()].sort((a, b) => a[1] - b[1]);
    for (const [code, distance] of sortedAncestors) {
      const skills = skillsByStandardCode.get(code) || [];
      if (!skills.length) continue;
      const sourceNode = nodesByCode.get(code);
      if (!sourceNode) continue;
      pushSkills(skills, 'ancestor', distance, sourceNode);
    }
  } else {
    pushSkills(directSkills, 'focus', 0, focusNode);
    const sortedDescendants = [...descendantDistances.entries()].sort((a, b) => a[1] - b[1]);
    for (const [code, distance] of sortedDescendants) {
      if (distance > 1) continue;
      const skills = skillsByStandardCode.get(code) || [];
      if (!skills.length) continue;
      const sourceNode = nodesByCode.get(code);
      if (!sourceNode) continue;
      pushSkills(skills, 'descendant', distance, sourceNode);
    }
  }

  const deduped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.source_standard_code}:${candidate.skill_id}`;
    const existing = deduped.get(key);
    if (!existing || sortCandidates(candidate, existing) < 0) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()].sort(sortCandidates).slice(0, maxCandidatesPerMode);
}

function buildPrerequisiteStandards({
  focusNode,
  ancestorDistances,
  nodesByCode,
  skillsByStandardCode,
  descendantCounts,
  maxPrerequisites,
}) {
  const standards = [];
  for (const [code, distance] of ancestorDistances) {
    const sourceNode = nodesByCode.get(code);
    if (!sourceNode) continue;
    const skills = skillsByStandardCode.get(code) || [];
    if (!skills.length) continue;
    standards.push({
      standard_code: code,
      grade: sourceNode.grade,
      domain: sourceNode.domain,
      distance,
      skill_count: skills.length,
      graph_support: graphSupportScore(
        code,
        descendantCounts,
        Math.max(...descendantCounts.values(), 1),
      ),
      cross_grade_gap: gradeGapScore(focusNode, sourceNode),
    });
  }

  standards.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (b.skill_count !== a.skill_count) return b.skill_count - a.skill_count;
    return a.standard_code.localeCompare(b.standard_code, undefined, { numeric: true });
  });

  return standards.slice(0, maxPrerequisites);
}

function emptyPayload(outFile) {
  const payload = {
    generatedAt: new Date().toISOString(),
    score_version: 'adaptive-v1',
    modes: MODE_META,
    by_standard_code: {},
    stats: {
      standard_count: 0,
      standards_with_direct_skills: 0,
      candidate_count: 0,
    },
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload));
  return payload;
}

export async function buildCoherenceAdaptive({
  graphFile,
  ixlFile,
  outFile,
  maxCandidatesPerMode = DEFAULT_MAX_CANDIDATES,
  maxPrerequisites = DEFAULT_MAX_PREREQUISITES,
}) {
  if (!fs.existsSync(graphFile) || !fs.existsSync(ixlFile)) {
    console.error('  Adaptive diagnostic sources missing; writing empty artifact.');
    return emptyPayload(outFile);
  }

  const graph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
  const ixl = JSON.parse(fs.readFileSync(ixlFile, 'utf8'));

  const selectableNodes = graph.nodes.filter(
    (node) => node.code && (node.level === 'standard' || node.level === 'substandard'),
  );
  const nodesByCode = new Map(selectableNodes.map((node) => [node.code, node]));
  const { forward, reverse } = buildAdjacency(graph, nodesByCode);

  const skillsByStandardCode = new Map();
  for (const [standardCode, record] of Object.entries(ixl.by_standard_code || {})) {
    skillsByStandardCode.set(
      standardCode,
      (record.skills || []).map((skill) => normalizeSkill(skill)),
    );
  }

  const descendantDistancesByCode = new Map();
  const ancestorDistancesByCode = new Map();
  const descendantCounts = new Map();
  let maxDescendants = 0;

  for (const node of selectableNodes) {
    const descendantDistances = distancesFrom(node.code, forward);
    const ancestorDistances = distancesFrom(node.code, reverse);
    descendantDistancesByCode.set(node.code, descendantDistances);
    ancestorDistancesByCode.set(node.code, ancestorDistances);
    descendantCounts.set(node.code, descendantDistances.size);
    maxDescendants = Math.max(maxDescendants, descendantDistances.size);
  }

  console.error('  Building adaptive skill-selection plans...');
  const payload = {
    generatedAt: new Date().toISOString(),
    score_version: 'adaptive-v1',
    modes: MODE_META,
    by_standard_code: {},
    stats: {
      standard_count: selectableNodes.length,
      standards_with_direct_skills: 0,
      candidate_count: 0,
    },
  };

  for (const focusNode of selectableNodes) {
    const directSkills = skillsByStandardCode.get(focusNode.code) || [];
    const ancestorDistances = ancestorDistancesByCode.get(focusNode.code) || new Map();
    const descendantDistances = descendantDistancesByCode.get(focusNode.code) || new Map();

    const candidates = Object.fromEntries(
      MODE_ORDER.map((mode) => [
        mode,
        buildModeCandidates({
          mode,
          focusNode,
          directSkills,
          ancestorDistances,
          descendantDistances,
          nodesByCode,
          skillsByStandardCode,
          descendantCounts,
          maxDescendants,
          maxCandidatesPerMode,
        }),
      ]),
    );

    const prerequisiteStandards = buildPrerequisiteStandards({
      focusNode,
      ancestorDistances,
      nodesByCode,
      skillsByStandardCode,
      descendantCounts,
      maxPrerequisites,
    });

    payload.by_standard_code[focusNode.code] = {
      focus_standard_code: focusNode.code,
      focus_grade: focusNode.grade,
      focus_domain: focusNode.domain,
      direct_skill_count: directSkills.length,
      ancestor_standard_count: ancestorDistances.size,
      descendant_standard_count: descendantDistances.size,
      prerequisite_standards: prerequisiteStandards,
      candidates,
    };

    if (directSkills.length) payload.stats.standards_with_direct_skills += 1;
    payload.stats.candidate_count += MODE_ORDER.reduce(
      (sum, mode) => sum + candidates[mode].length,
      0,
    );
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload));
  console.error(
    `    ${payload.stats.standard_count} standards, ${payload.stats.candidate_count} ranked skill candidates`,
  );
  return payload;
}
