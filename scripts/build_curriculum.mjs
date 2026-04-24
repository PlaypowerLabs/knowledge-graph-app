#!/usr/bin/env node
// Precompute the Illustrative Mathematics 360 curriculum dependency map.
//
// Source: `LessonGrouping` nodes (curriculum units) and `hasDependency`
// relationships in the Learning Commons Knowledge Graph. This is the
// curriculum-ordering counterpart to the SAP Coherence Map (see
// build_coherence.mjs): `hasDependency` sequences UNITS within IM 360, while
// `buildsTowards` sequences STANDARDS per SAP.
//
// Inputs:  data/math/{nodes,relationships}.jsonl
// Outputs: app/public/curriculum/graph.json
//          app/public/curriculum/index.json
//          app/public/curriculum/focus/<shortId>.json  (one per unit with edges)

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'data', 'math');
const OUT = path.join(REPO, 'app', 'public', 'curriculum');
const FOCUS_DIR = path.join(OUT, 'focus');

const KEEP_EDGE_LABELS = new Set(['hasDependency']);

async function* lines(p) {
  const rl = readline.createInterface({
    input: fs.createReadStream(p, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const l of rl) if (l) yield l;
}

function pushMulti(m, k, v) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function parseGradeLevel(raw) {
  if (raw == null) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch {
    return [String(raw)];
  }
}

// Group IM 360 course codes into school bands for the column layout.
// Course codes come in as `im360:K`, `im360:5`, `im360:Acc6`, `im360:Alg1+`, etc.
function bandFor(courseCode) {
  const t = courseCode.replace(/^im360:/, '');
  if (/^(K|[1-5])$/.test(t)) return 'Elementary';
  if (/^(6|7|8|Acc6|Acc7)$/.test(t)) return 'Middle';
  return 'High'; // Alg1, Alg1+, Alg2, Geo, Math1, Math2, Math3
}

// Sort order within a band. Elementary K→5, Middle 6→8 then Acc, High Alg1→Geo.
const COURSE_ORDER = [
  'im360:K', 'im360:1', 'im360:2', 'im360:3', 'im360:4', 'im360:5',
  'im360:6', 'im360:7', 'im360:8', 'im360:Acc6', 'im360:Acc7',
  'im360:Alg1', 'im360:Alg1+', 'im360:Alg2', 'im360:Geo',
  'im360:Math1', 'im360:Math2', 'im360:Math3',
];
function courseRank(code) {
  const i = COURSE_ORDER.indexOf(code);
  return i === -1 ? 99 : i;
}

// LessonGrouping ids are prefixed `im:<uuid>`. Strip for filesystem-safe focus
// filenames; callers reconstruct by prepending `im:`.
function shortId(id) {
  return id.replace(/^im:/, '');
}

const t0 = Date.now();

console.error('[1/4] Loading LessonGrouping nodes...');
const nodes = new Map();
for await (const line of lines(path.join(SRC, 'nodes.jsonl'))) {
  const rec = JSON.parse(line);
  if (!rec.labels?.includes('LessonGrouping')) continue;
  const p = rec.properties || {};
  nodes.set(rec.identifier, {
    id: rec.identifier,
    shortId: shortId(rec.identifier),
    name: p.name || null,
    ordinalName: p.ordinalName || null,
    position: typeof p.position === 'number' ? p.position : Number(p.position ?? 0),
    courseCode: p.courseCode || null,
    band: p.courseCode ? bandFor(p.courseCode) : null,
    gradeLevels: parseGradeLevel(p.gradeLevel),
    timeRequired: p.timeRequired || null,
    curriculumLabel: p.curriculumLabel || null,
    groupLevel: typeof p.groupLevel === 'number' ? p.groupLevel : Number(p.groupLevel ?? 0),
    author: p.author || null,
    dateCreated: p.dateCreated || null,
  });
}
console.error(`  ${nodes.size} LessonGrouping nodes`);

console.error('[2/4] Loading hasDependency edges...');
// `hasDependency` reads (source depends on target) — source is the dependent,
// target the prerequisite. That's the inverse of `buildsTowards` (source
// builds toward target, i.e., source is earlier). We flip here so every
// precomputed graph in this app uses the same convention:
//     source = prerequisite, target = dependent/later
// Result: arrows point from earlier to later, and `closure(rev, n)` is always
// ancestors/prerequisites.
const edges = [];
const edgeCounts = {};
for await (const line of lines(path.join(SRC, 'relationships.jsonl'))) {
  const r = JSON.parse(line);
  if (!KEEP_EDGE_LABELS.has(r.label)) continue;
  if (!nodes.has(r.source_identifier) || !nodes.has(r.target_identifier)) continue;
  edges.push({
    id: r.identifier,
    label: r.label,
    source: r.target_identifier, // prerequisite
    target: r.source_identifier, // dependent
  });
  edgeCounts[r.label] = (edgeCounts[r.label] || 0) + 1;
}
console.error(`  kept ${edges.length} edges:`, edgeCounts);

// Adjacency for focus ego networks.
const fwd = new Map(); // source -> [targets] (this unit depends on those)
const rev = new Map(); // target -> [sources] (these units depend on this)
for (const e of edges) {
  pushMulti(fwd, e.source, e.target);
  pushMulti(rev, e.target, e.source);
}

function closure(adj, start) {
  const seen = new Set();
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    for (const nxt of adj.get(cur) || []) {
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      q.push(nxt);
    }
  }
  return seen;
}

console.error('[3/4] Writing graph.json and index.json...');
fs.mkdirSync(FOCUS_DIR, { recursive: true });

// Sort nodes: band (Elementary/Middle/High), then course rank, then position.
const sortedNodes = [...nodes.values()].sort((a, b) => {
  const bandOrder = { Elementary: 0, Middle: 1, High: 2 };
  const bd = (bandOrder[a.band] ?? 9) - (bandOrder[b.band] ?? 9);
  if (bd) return bd;
  const cd = courseRank(a.courseCode || '') - courseRank(b.courseCode || '');
  if (cd) return cd;
  return (a.position ?? 0) - (b.position ?? 0);
});

const graph = {
  generatedAt: new Date().toISOString(),
  nodes: sortedNodes,
  edges,
  stats: {
    nodeCount: sortedNodes.length,
    edgeCount: edges.length,
    edgesByLabel: edgeCounts,
  },
};
fs.writeFileSync(path.join(OUT, 'graph.json'), JSON.stringify(graph));

// Index: id -> summary, course/band axes, ordered units per course.
const byId = {};
const byShortId = {};
const coursesSet = new Set();
const unitsByCourse = {};
for (const n of sortedNodes) {
  byId[n.id] = {
    id: n.id,
    shortId: n.shortId,
    name: n.name,
    ordinalName: n.ordinalName,
    courseCode: n.courseCode,
    band: n.band,
    position: n.position,
  };
  byShortId[n.shortId] = n.id;
  if (n.courseCode) coursesSet.add(n.courseCode);
  if (n.courseCode) {
    (unitsByCourse[n.courseCode] ||= []).push({
      id: n.id,
      shortId: n.shortId,
      name: n.name,
      ordinalName: n.ordinalName,
      position: n.position,
    });
  }
}
for (const arr of Object.values(unitsByCourse)) {
  arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
const courses = [...coursesSet].sort((a, b) => courseRank(a) - courseRank(b));

const index = {
  generatedAt: graph.generatedAt,
  byId,
  byShortId,
  courses,
  bands: ['Elementary', 'Middle', 'High'],
  unitsByCourse,
};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));

console.error('[4/4] Writing per-unit focus ego networks...');
let focusCount = 0;
const orphans = [];
for (const n of sortedNodes) {
  const hasIn = rev.has(n.id);
  const hasOut = fwd.has(n.id);
  if (!hasIn && !hasOut) {
    orphans.push({ id: n.id, name: n.name, courseCode: n.courseCode });
    continue;
  }

  const ancestorIds = closure(rev, n.id); // prerequisite units
  const descendantIds = closure(fwd, n.id); // subsequent units
  const scope = new Set([n.id, ...ancestorIds, ...descendantIds]);

  const ancestors = [...ancestorIds].map((id) => nodes.get(id)).filter(Boolean);
  const descendants = [...descendantIds].map((id) => nodes.get(id)).filter(Boolean);

  const focusEdges = edges.filter((e) => scope.has(e.source) && scope.has(e.target));

  const payload = {
    focus: n,
    ancestors: ancestors.sort(
      (a, b) =>
        courseRank(a.courseCode || '') - courseRank(b.courseCode || '') ||
        (a.position ?? 0) - (b.position ?? 0),
    ),
    descendants: descendants.sort(
      (a, b) =>
        courseRank(a.courseCode || '') - courseRank(b.courseCode || '') ||
        (a.position ?? 0) - (b.position ?? 0),
    ),
    edges: focusEdges,
    stats: {
      ancestorCount: ancestors.length,
      descendantCount: descendants.length,
      edgeCount: focusEdges.length,
    },
  };
  fs.writeFileSync(path.join(FOCUS_DIR, `${n.shortId}.json`), JSON.stringify(payload));
  focusCount++;
}

console.error(`  wrote ${focusCount} focus files, ${orphans.length} orphans`);
fs.writeFileSync(
  path.join(OUT, 'orphans.json'),
  JSON.stringify({ generatedAt: graph.generatedAt, orphans }, null, 2),
);

console.error(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);
