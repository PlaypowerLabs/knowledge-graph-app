#!/usr/bin/env node
// Look up a node by identifier prefix, plus its parents and children.
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'math');

async function* lines(p) {
  const rl = readline.createInterface({
    input: fs.createReadStream(p, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const l of rl) if (l) yield l;
}

const prefix = (process.argv[2] || '').toLowerCase();
if (!prefix) {
  console.error('Usage: node inspect_node.mjs <id-prefix>');
  process.exit(1);
}

// Find node(s) matching the prefix
const matches = [];
for await (const line of lines(path.join(DATA, 'nodes.jsonl'))) {
  const rec = JSON.parse(line);
  if (rec.identifier.toLowerCase().startsWith(prefix)) matches.push(rec);
}
console.log(`matches for prefix "${prefix}": ${matches.length}`);
for (const m of matches) console.log('  full id:', m.identifier, 'labels:', m.labels.join('+'));
if (!matches.length) process.exit(0);

const ids = new Set(matches.map((m) => m.identifier));

// Find parents (incoming hasChild) and children (outgoing hasChild)
const parentIds = new Set();
const childIds = new Set();
const edgeSummaries = [];
for await (const line of lines(path.join(DATA, 'relationships.jsonl'))) {
  const rec = JSON.parse(line);
  if (ids.has(rec.source_identifier)) {
    edgeSummaries.push(`OUT ${rec.label}: ${rec.source_identifier.slice(0, 8)} -> ${rec.target_identifier.slice(0, 8)} (${rec.target_labels.join('+')})`);
    if (rec.label === 'hasChild') childIds.add(rec.target_identifier);
  }
  if (ids.has(rec.target_identifier)) {
    edgeSummaries.push(`IN  ${rec.label}: ${rec.source_identifier.slice(0, 8)} (${rec.source_labels.join('+')}) -> ${rec.target_identifier.slice(0, 8)}`);
    if (rec.label === 'hasChild') parentIds.add(rec.source_identifier);
  }
}

// Fetch node records for parents and children
const needed = new Set([...parentIds, ...childIds]);
const detail = new Map();
if (needed.size) {
  for await (const line of lines(path.join(DATA, 'nodes.jsonl'))) {
    const rec = JSON.parse(line);
    if (needed.has(rec.identifier)) detail.set(rec.identifier, rec);
    if (detail.size === needed.size) break;
  }
}

for (const m of matches) {
  console.log('\n===', m.identifier, '===');
  console.log('labels:', m.labels);
  console.log('properties:', JSON.stringify(m.properties, null, 2));

  console.log('\nparents (incoming hasChild):');
  for (const pid of parentIds) {
    const n = detail.get(pid);
    if (!n) continue;
    console.log('  ', pid.slice(0, 8), n.labels.join('+'),
      'code=', n.properties.statementCode || '-',
      'type=', n.properties.normalizedStatementType || '-',
      'name=', (n.properties.name || n.properties.description || '').slice(0, 70));
  }

  console.log('\nchildren (outgoing hasChild):');
  const sortedChildren = [...childIds].map(c => detail.get(c)).filter(Boolean)
    .sort((a,b) => (a.properties.statementCode||'').localeCompare(b.properties.statementCode||''));
  for (const n of sortedChildren) {
    console.log('  ',
      n.identifier.slice(0, 8),
      'code=', (n.properties.statementCode || '-').padEnd(15),
      'type=', (n.properties.normalizedStatementType || '-').padEnd(20),
      'grade=', (n.properties.gradeLevel || '-').padEnd(12),
      (n.properties.description || '').slice(0, 70));
  }

  if (edgeSummaries.length) {
    console.log('\nother edges (first 20):');
    for (const s of edgeSummaries.slice(0, 20)) console.log('  ', s);
    if (edgeSummaries.length > 20) console.log('  ...', edgeSummaries.length - 20, 'more');
  }
}
