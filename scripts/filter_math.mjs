#!/usr/bin/env node
// Filter full dataset to Mathematics only.
//   - nodes: keep those with properties.academicSubject === "Mathematics"
//   - relationships: keep those where BOTH endpoints are kept nodes

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'data');
const SRC_NODES = path.join(DATA, 'nodes.jsonl');
const SRC_RELS = path.join(DATA, 'relationships.jsonl');
const OUT_DIR = path.join(DATA, 'math');
const OUT_NODES = path.join(OUT_DIR, 'nodes.jsonl');
const OUT_RELS = path.join(OUT_DIR, 'relationships.jsonl');
const OUT_META = path.join(OUT_DIR, 'meta.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

async function* lines(p) {
  const rl = readline.createInterface({
    input: fs.createReadStream(p, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const l of rl) if (l) yield l;
}

const t0 = Date.now();

console.error('[1/2] Filtering nodes by academicSubject === "Mathematics"...');
const keep = new Set();
const labelCounts = {};
const jurisdictions = new Set();
const frameworks = []; // { identifier, name, jurisdiction }
const nodesOut = fs.createWriteStream(OUT_NODES);
let nTotal = 0, nKept = 0;
for await (const line of lines(SRC_NODES)) {
  nTotal++;
  const rec = JSON.parse(line);
  const p = rec.properties || {};
  if (p.academicSubject !== 'Mathematics') continue;
  keep.add(rec.identifier);
  nKept++;
  const primary = (rec.labels && rec.labels[0]) || '<none>';
  labelCounts[primary] = (labelCounts[primary] || 0) + 1;
  if (p.jurisdiction) jurisdictions.add(p.jurisdiction);
  if (rec.labels?.includes('StandardsFramework')) {
    frameworks.push({
      identifier: rec.identifier,
      name: p.name || null,
      jurisdiction: p.jurisdiction || null,
    });
  }
  nodesOut.write(line + '\n');
}
nodesOut.end();
await new Promise(r => nodesOut.on('close', r));

console.error(`      kept ${nKept.toLocaleString()} / ${nTotal.toLocaleString()} nodes`);

console.error('[2/2] Filtering relationships where both endpoints are math nodes...');
const relLabelCounts = {};
const relsOut = fs.createWriteStream(OUT_RELS);
let rTotal = 0, rKept = 0;
for await (const line of lines(SRC_RELS)) {
  rTotal++;
  const rec = JSON.parse(line);
  if (!keep.has(rec.source_identifier) || !keep.has(rec.target_identifier)) continue;
  rKept++;
  const lbl = rec.label || '<none>';
  relLabelCounts[lbl] = (relLabelCounts[lbl] || 0) + 1;
  relsOut.write(line + '\n');
}
relsOut.end();
await new Promise(r => relsOut.on('close', r));

console.error(`      kept ${rKept.toLocaleString()} / ${rTotal.toLocaleString()} relationships`);

const meta = {
  generatedAt: new Date().toISOString(),
  source: { nodes: SRC_NODES, relationships: SRC_RELS },
  nodes: { total: nTotal, kept: nKept, byLabel: labelCounts },
  relationships: { total: rTotal, kept: rKept, byLabel: relLabelCounts },
  jurisdictions: [...jurisdictions].sort(),
  frameworks: frameworks.sort((a, b) => (a.jurisdiction || '').localeCompare(b.jurisdiction || '')),
  durationMs: Date.now() - t0,
};
fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2));
console.error(`\nDone in ${(meta.durationMs / 1000).toFixed(1)}s -> ${OUT_DIR}`);
console.error('Node labels:', labelCounts);
console.error('Rel labels:', relLabelCounts);
console.error('Jurisdictions:', meta.jurisdictions.length);
