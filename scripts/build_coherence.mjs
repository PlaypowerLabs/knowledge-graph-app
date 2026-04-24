#!/usr/bin/env node
// Precompute the Student Achievement Partners (SAP) Coherence Map.
//
// Source of truth: Multi-State CCSS-M `StandardsFrameworkItem` nodes and
// `buildsTowards` relationships in the Learning Commons Knowledge Graph.
// The MCP `find_standards_progression_from_standard` tool traverses the same
// edges, so a focus file keyed by `caseIdentifierUUID` lines up with the
// connector for side-panel enrichment later.
//
// Inputs:  data/math/{nodes,relationships}.jsonl
// Outputs: app/public/coherence/graph.json
//          app/public/coherence/index.json
//          app/public/coherence/focus/<caseIdentifierUUID>.json  (one per edge-bearing standard)

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'data', 'math');
const OUT = path.join(REPO, 'app', 'public', 'coherence');
const FOCUS_DIR = path.join(OUT, 'focus');

// Edges kept in the coherence graph. `buildsTowards` is the SAP progression;
// `relatesTo` and `mutuallyExclusiveWith` add context without implying sequence.
const KEEP_EDGE_LABELS = new Set(['buildsTowards', 'relatesTo', 'mutuallyExclusiveWith']);

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

// `gradeLevel` is stored as a JSON-encoded string like "[\"3\"]".
function parseGradeLevel(raw) {
  if (raw == null) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch {
    return [String(raw)];
  }
}

// Derive {grade, domain, cluster, level} from a CCSS-M statementCode.
// Covers K-8 (`3.NF.A.1`), substandards (`1.NBT.B.2.a`), cluster headers
// (`3.NF.A`), domain headers (`3.NF`), HS conceptual categories
// (`HSA-REI.B.3`, `HSA-APR.A`), and Mathematical Practices (`1.MP1`, `HS.MP1`).
function parseCode(code) {
  const empty = { grade: null, domain: null, cluster: null, level: null };
  if (!code) return empty;

  const hsmp = code.match(/^HS\.MP(\d+)$/);
  if (hsmp) return { grade: 'HS', domain: 'MP', cluster: 'HS.MP', level: 'standard' };

  const gmp = code.match(/^([K\d]+)\.MP(\d+)$/);
  if (gmp) return { grade: gmp[1], domain: 'MP', cluster: `${gmp[1]}.MP`, level: 'standard' };

  const hs = code.match(/^HS([A-Z]+(?:-[A-Z]+)?)(?:\.([A-Z])(?:\.(\d+)(?:\.([a-z]))?)?)?$/);
  if (hs) {
    const [, dom, cl, num, sub] = hs;
    const level = sub ? 'substandard' : num ? 'standard' : cl ? 'cluster' : 'domain';
    return {
      grade: 'HS',
      domain: dom,
      cluster: cl ? `HS${dom}.${cl}` : null,
      level,
    };
  }

  const m = code.match(/^([K\d]+)\.([A-Z]+)(?:\.([A-Z])(?:\.(\d+)(?:\.([a-z]))?)?)?$/);
  if (m) {
    const [, grade, dom, cl, num, sub] = m;
    const level = sub ? 'substandard' : num ? 'standard' : cl ? 'cluster' : 'domain';
    return {
      grade,
      domain: dom,
      cluster: cl ? `${grade}.${dom}.${cl}` : null,
      level,
    };
  }

  return empty;
}

// For sort/layout: K=0, 1..8, HS=9. Unknown grades sort last.
function gradeRank(g) {
  if (g == null) return 99;
  if (g === 'K') return 0;
  if (g === 'HS') return 9;
  const n = Number(g);
  return Number.isFinite(n) ? n : 99;
}

const t0 = Date.now();

console.error('[1/4] Loading Multi-State CCSS-M nodes...');
const nodes = new Map(); // identifier -> compact node record
for await (const line of lines(path.join(SRC, 'nodes.jsonl'))) {
  const rec = JSON.parse(line);
  if (!rec.labels?.includes('StandardsFrameworkItem')) continue;
  const p = rec.properties || {};
  if (p.jurisdiction !== 'Multi-State') continue;
  if (p.academicSubject !== 'Mathematics') continue;
  const parsed = parseCode(p.statementCode);
  nodes.set(rec.identifier, {
    id: rec.identifier,
    caseIdentifierUUID: p.caseIdentifierUUID || null,
    code: p.statementCode || null,
    description: p.description || null,
    statementType: p.statementType || null,
    gradeLevels: parseGradeLevel(p.gradeLevel),
    grade: parsed.grade,
    domain: parsed.domain,
    cluster: parsed.cluster,
    level: parsed.level,
  });
}
console.error(`  ${nodes.size} Multi-State CCSS-M SFI nodes`);

console.error('[2/4] Loading buildsTowards (+ relatesTo, mutuallyExclusiveWith) edges...');
const edges = []; // { id, label, source, target }
const edgeCounts = {};
for await (const line of lines(path.join(SRC, 'relationships.jsonl'))) {
  const r = JSON.parse(line);
  if (!KEEP_EDGE_LABELS.has(r.label)) continue;
  if (!nodes.has(r.source_identifier) || !nodes.has(r.target_identifier)) continue;
  edges.push({
    id: r.identifier,
    label: r.label,
    source: r.source_identifier,
    target: r.target_identifier,
  });
  edgeCounts[r.label] = (edgeCounts[r.label] || 0) + 1;
}
console.error(`  kept ${edges.length} edges:`, edgeCounts);

// Adjacency for focus ego networks. Build from `buildsTowards` only; the other
// edge labels live in the main graph but do not define progression.
const fwd = new Map(); // source -> [targets] (progression: prereq -> next)
const rev = new Map(); // target -> [sources]
for (const e of edges) {
  if (e.label !== 'buildsTowards') continue;
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

// Sort nodes for stable output: grade, then cluster, then code.
const sortedNodes = [...nodes.values()].sort((a, b) => {
  const gd = gradeRank(a.grade) - gradeRank(b.grade);
  if (gd) return gd;
  return (a.code || '').localeCompare(b.code || '', undefined, { numeric: true });
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

// Index: code -> uuid, uuid -> summary, grades/domains/clusters for search.
const byCode = {};
const byUuid = {};
const gradesSet = new Set();
const domainsSet = new Set();
const clustersByGrade = {};
for (const n of sortedNodes) {
  if (n.code) byCode[n.code] = n.caseIdentifierUUID;
  if (n.caseIdentifierUUID) {
    byUuid[n.caseIdentifierUUID] = {
      id: n.id,
      code: n.code,
      grade: n.grade,
      domain: n.domain,
      cluster: n.cluster,
      level: n.level,
    };
  }
  if (n.grade) gradesSet.add(n.grade);
  if (n.domain) domainsSet.add(n.domain);
  if (n.grade && n.cluster) {
    (clustersByGrade[n.grade] ||= new Set()).add(n.cluster);
  }
}
const index = {
  generatedAt: graph.generatedAt,
  byCode,
  byUuid,
  grades: [...gradesSet].sort((a, b) => gradeRank(a) - gradeRank(b)),
  domains: [...domainsSet].sort(),
  clustersByGrade: Object.fromEntries(
    Object.entries(clustersByGrade).map(([g, s]) => [g, [...s].sort()]),
  ),
};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));

console.error('[4/4] Writing per-standard focus ego networks...');
// Emit one focus file per node that has at least one buildsTowards edge
// (in or out). Skip pure structural nodes (Domain/Cluster headers with no edges).
let focusCount = 0;
const focusSizes = [];
// Orphan tracker for verification reports.
const orphans = [];
for (const n of sortedNodes) {
  const hasIn = rev.has(n.id);
  const hasOut = fwd.has(n.id);
  if (!hasIn && !hasOut) {
    orphans.push({ code: n.code, grade: n.grade, level: n.level });
    continue;
  }
  if (!n.caseIdentifierUUID) continue;

  const ancestorIds = closure(rev, n.id); // prerequisites
  const descendantIds = closure(fwd, n.id); // subsequents
  const scope = new Set([n.id, ...ancestorIds, ...descendantIds]);

  const ancestors = [...ancestorIds].map((id) => nodes.get(id)).filter(Boolean);
  const descendants = [...descendantIds].map((id) => nodes.get(id)).filter(Boolean);

  // Keep only buildsTowards edges inside the ego network (side panel uses this
  // to render the hierarchical focus graph; other labels add noise here).
  const focusEdges = edges.filter(
    (e) => e.label === 'buildsTowards' && scope.has(e.source) && scope.has(e.target),
  );

  const payload = {
    focus: n,
    ancestors: ancestors.sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade)),
    descendants: descendants.sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade)),
    edges: focusEdges,
    stats: {
      ancestorCount: ancestors.length,
      descendantCount: descendants.length,
      edgeCount: focusEdges.length,
    },
  };
  const json = JSON.stringify(payload);
  fs.writeFileSync(path.join(FOCUS_DIR, `${n.caseIdentifierUUID}.json`), json);
  focusCount++;
  focusSizes.push({ code: n.code, bytes: json.length });
}

focusSizes.sort((a, b) => b.bytes - a.bytes);
console.error(`  wrote ${focusCount} focus files`);
console.error('  top 5 by size:');
for (const s of focusSizes.slice(0, 5)) {
  console.error(`    ${(s.bytes / 1000).toFixed(1)} KB  ${s.code}`);
}
console.error(`  ${orphans.length} nodes had no buildsTowards edges (skipped)`);

// Write orphan report alongside the graph for manual review during Phase 5.
fs.writeFileSync(
  path.join(OUT, 'orphans.json'),
  JSON.stringify({ generatedAt: graph.generatedAt, orphans }, null, 2),
);

console.error(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);
