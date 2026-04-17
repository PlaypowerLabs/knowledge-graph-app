#!/usr/bin/env node
// Enumerate the normalizedStatementType / statementType distribution among
// StandardsFrameworkItem nodes in the math slice.
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'math');
const rl = readline.createInterface({
  input: fs.createReadStream(path.join(DATA, 'nodes.jsonl'), { encoding: 'utf-8' }),
  crlfDelay: Infinity,
});

const normCounts = {};
const typeCounts = {};
const combo = {};
const missing = { noNorm: 0, noType: 0, both: 0 };
let total = 0;

for await (const line of rl) {
  if (!line) continue;
  const rec = JSON.parse(line);
  if (!rec.labels?.includes('StandardsFrameworkItem')) continue;
  total++;
  const n = rec.properties.normalizedStatementType ?? '<none>';
  const t = rec.properties.statementType ?? '<none>';
  normCounts[n] = (normCounts[n] || 0) + 1;
  typeCounts[t] = (typeCounts[t] || 0) + 1;
  combo[`${n} / ${t}`] = (combo[`${n} / ${t}`] || 0) + 1;
  if (n === '<none>') missing.noNorm++;
  if (t === '<none>') missing.noType++;
  if (n === '<none>' && t === '<none>') missing.both++;
}

console.log(`total SFIs: ${total.toLocaleString()}`);

console.log('\nnormalizedStatementType:');
for (const [k, v] of Object.entries(normCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(7)}  ${k}`);
}

console.log('\nstatementType (top 15):');
for (const [k, v] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(v).padStart(7)}  ${k}`);
}

console.log('\ntop combinations (normalized / raw):');
for (const [k, v] of Object.entries(combo).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(v).padStart(7)}  ${k}`);
}

console.log('\nmissing:', missing);
