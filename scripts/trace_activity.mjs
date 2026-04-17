#!/usr/bin/env node
// Pick one Activity, walk its containment chain up to the Course root, and
// show the standards it aligns to.
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

// Load all nodes
const nodes = new Map();
for await (const line of lines(path.join(DATA, 'nodes.jsonl'))) {
  const rec = JSON.parse(line);
  nodes.set(rec.identifier, rec);
}

// Load all hasPart + hasEducationalAlignment edges
const partParentOf = new Map();   // child_id -> parent_id  (from Lesson -> Activity edge, child is Activity)
const alignmentOf = new Map();    // source_id -> [target_sfi_id]
for await (const line of lines(path.join(DATA, 'relationships.jsonl'))) {
  const rec = JSON.parse(line);
  if (rec.label === 'hasPart') {
    partParentOf.set(rec.target_identifier, rec.source_identifier);
  } else if (rec.label === 'hasEducationalAlignment') {
    const arr = alignmentOf.get(rec.source_identifier) || [];
    arr.push({ targetId: rec.target_identifier, props: rec.properties });
    alignmentOf.set(rec.source_identifier, arr);
  }
}

// Pick an Activity that has both: a parent chain up to a Course AND a standards alignment.
let picked = null;
for (const [id, rec] of nodes) {
  if (!rec.labels.includes('Activity')) continue;
  // Check it has both alignment and a parent
  if (!alignmentOf.has(id)) continue;
  if (!partParentOf.has(id)) continue;
  // Walk up until Course or dead end
  let cur = id, depth = 0, reachedCourse = false;
  while (partParentOf.has(cur) && depth < 10) {
    cur = partParentOf.get(cur);
    depth++;
    const n = nodes.get(cur);
    if (n?.labels.includes('Course')) { reachedCourse = true; break; }
  }
  if (reachedCourse) { picked = id; break; }
}

if (!picked) {
  console.log('no activity with full chain found');
  process.exit(0);
}

const activity = nodes.get(picked);
console.log('=== ACTIVITY ===');
console.log('id:', activity.identifier);
console.log('name:', activity.properties.name);
console.log('curriculumLabel:', activity.properties.curriculumLabel);
console.log('ordinalName:', activity.properties.ordinalName);
console.log('timeRequired:', activity.properties.timeRequired);
console.log('courseCode:', activity.properties.courseCode);
console.log('grade:', activity.properties.gradeLevel);
console.log('audience:', activity.properties.audience);
console.log('author:', activity.properties.author);

console.log('\n=== CONTAINMENT PATH (hasPart, child -> parent) ===');
let cur = picked;
const chain = [{ node: activity }];
while (partParentOf.has(cur)) {
  const pid = partParentOf.get(cur);
  const p = nodes.get(pid);
  if (!p) break;
  chain.push({ node: p });
  cur = pid;
}
for (let i = chain.length - 1; i >= 0; i--) {
  const n = chain[i].node;
  const p = n.properties;
  const label = n.labels[0];
  const display = p.name || p.ordinalName || p.description?.slice(0, 50) || n.identifier.slice(0, 8);
  const indent = '  '.repeat(chain.length - 1 - i);
  console.log(`${indent}${label}: ${display}`);
  if (p.curriculumLabel) console.log(`${indent}  [${p.curriculumLabel}]`);
  if (p.courseCode) console.log(`${indent}  courseCode=${p.courseCode}`);
}

console.log('\n=== STANDARDS ALIGNED (hasEducationalAlignment) ===');
const aligns = alignmentOf.get(picked) || [];
for (const a of aligns.slice(0, 8)) {
  const t = nodes.get(a.targetId);
  if (!t) continue;
  const p = t.properties;
  console.log(`  [${a.props?.alignmentType || '?'}] ${p.statementCode || '-'} (${p.jurisdiction}) ${(p.description || '').slice(0, 80).replace(/\s+/g, ' ')}`);
}
if (aligns.length > 8) console.log(`  ... ${aligns.length - 8} more`);
