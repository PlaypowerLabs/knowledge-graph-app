#!/usr/bin/env node
// Precompute per-framework subgraph JSON into app/public/subgraphs/ so the
// app can be served as static assets on Vercel (no serverless fn needed).
//
// Inputs:  data/math/{nodes,relationships}.jsonl
// Outputs: app/public/subgraphs/frameworks.json
//          app/public/subgraphs/<framework_id>_<curriculum>.json  (one per variant)

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'data', 'math');
const OUT = path.join(REPO, 'app', 'public', 'subgraphs');

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

function buildAdj(rels) {
  const m = new Map();
  for (const r of rels) pushMulti(m, r.source_identifier, r.target_identifier);
  return m;
}
function buildReverseAdj(rels) {
  const m = new Map();
  for (const r of rels) pushMulti(m, r.target_identifier, r.source_identifier);
  return m;
}
function bfs(adj, start) {
  const seen = new Set([start]);
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

const t0 = Date.now();

console.error('[1/3] Loading nodes...');
const nodes = new Map();
const frameworks = [];
for await (const line of lines(path.join(SRC, 'nodes.jsonl'))) {
  const rec = JSON.parse(line);
  nodes.set(rec.identifier, rec);
  if (rec.labels.includes('StandardsFramework')) frameworks.push(rec);
}
frameworks.sort((a, b) =>
  String(a.properties.jurisdiction || '').localeCompare(String(b.properties.jurisdiction || '')),
);
console.error(`  ${nodes.size} nodes, ${frameworks.length} frameworks`);

console.error('[2/3] Loading relationships...');
const relsByLabel = new Map();
let relCount = 0;
for await (const line of lines(path.join(SRC, 'relationships.jsonl'))) {
  const r = JSON.parse(line);
  pushMulti(relsByLabel, r.label, r);
  relCount++;
}
console.error(`  ${relCount} relationships`);

const hasChildAll = relsByLabel.get('hasChild') || [];
const supportsAll = relsByLabel.get('supports') || [];
const alignAll = relsByLabel.get('hasEducationalAlignment') || [];
const hasPartAll = relsByLabel.get('hasPart') || [];

const hasChildAdj = buildAdj(hasChildAll);
const supportsRev = buildReverseAdj(supportsAll);
const alignRev = buildReverseAdj(alignAll);
const hasPartAdj = buildAdj(hasPartAll);

function computeSelected(frameworkId, includeCurriculum) {
  const selected = bfs(hasChildAdj, frameworkId);
  if (includeCurriculum) {
    for (const sfi of [...selected]) {
      for (const lc of supportsRev.get(sfi) || []) selected.add(lc);
    }
    const seeds = [];
    for (const sfi of selected) {
      for (const c of alignRev.get(sfi) || []) seeds.push(c);
    }
    for (const s of seeds) selected.add(s);
    for (const s of seeds) {
      for (const child of hasPartAdj.get(s) || []) selected.add(child);
    }
  }
  return selected;
}

// Properties dropped from every node before serialization. These are either
// boilerplate (attribution/license) or never consumed by the UI. Keeping them
// would inflate the committed public/subgraphs/* JSON by a large multiple.
const DROP_PROPS = new Set([
  'attributionStatement',
  'license',
  'provider',
  'inLanguage',
]);

function trimProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (DROP_PROPS.has(k)) continue;
    if (v == null || v === '') continue;
    out[k] = v;
  }
  return out;
}

function toOutNode(n) {
  return { id: n.identifier, labels: n.labels, properties: trimProps(n.properties) };
}
// Edge `properties` are never read by the UI — only id/label/source/target are.
function toOutEdge(r, i) {
  return {
    id: r.identifier ?? `e${i}`,
    label: r.label,
    source: r.source_identifier,
    target: r.target_identifier,
  };
}

console.error('[3/3] Writing per-framework subgraphs...');
fs.mkdirSync(OUT, { recursive: true });

// Framework index (client reads this instead of /api/frameworks).
const frameworksIndex = {
  frameworks: frameworks.map((f) => ({
    identifier: f.identifier,
    jurisdiction: f.properties.jurisdiction ?? null,
    name: f.properties.name ?? null,
  })),
  count: frameworks.length,
};
fs.writeFileSync(
  path.join(OUT, 'frameworks.json'),
  JSON.stringify(frameworksIndex),
);

// Flatten rels once for iteration.
const allRels = [];
for (const arr of relsByLabel.values()) for (const r of arr) allRels.push(r);

let totalBytes = 0;
const sizes = [];
for (const fw of frameworks) {
  for (const includeCurriculum of [false, true]) {
    const selected = computeSelected(fw.identifier, includeCurriculum);
    const outNodes = [];
    for (const id of selected) {
      const n = nodes.get(id);
      if (n) outNodes.push(toOutNode(n));
    }
    const outEdges = [];
    let i = 0;
    for (const r of allRels) {
      if (selected.has(r.source_identifier) && selected.has(r.target_identifier)) {
        outEdges.push(toOutEdge(r, i++));
      }
    }
    const payload = {
      nodes: outNodes,
      edges: outEdges,
      stats: { nodeCount: outNodes.length, edgeCount: outEdges.length, durationMs: 0 },
    };
    const fname = `${fw.identifier}_${includeCurriculum ? 'cur' : 'nocur'}.json`;
    const json = JSON.stringify(payload);
    fs.writeFileSync(path.join(OUT, fname), json);
    totalBytes += json.length;
    sizes.push({
      fw: fw.properties.jurisdiction || fw.identifier.slice(0, 8),
      cur: includeCurriculum,
      bytes: json.length,
      nodes: outNodes.length,
    });
  }
}

sizes.sort((a, b) => b.bytes - a.bytes);
console.error('\nTop 10 files by size:');
for (const s of sizes.slice(0, 10)) {
  console.error(`  ${(s.bytes / 1_000_000).toFixed(2)} MB  ${s.nodes.toString().padStart(6)} nodes  ${s.cur ? 'cur  ' : 'nocur'} ${s.fw}`);
}

console.error(
  `\nDone. ${frameworks.length} frameworks, ${(totalBytes / 1_000_000).toFixed(1)} MB total, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
