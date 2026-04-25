#!/usr/bin/env node
// Precompute the IM 360 unit ↔ CCSS-M standard alignment map.
//
// Source: `hasEducationalAlignment` edges where the source is a
// `LessonGrouping` (IM 360 unit) and the target is a `StandardsFrameworkItem`.
// All 8,752 alignments in the math slice target Multi-State standards, so we
// don't need jurisdiction splits here.
//
// The output is loaded by BOTH the /coherence page ("which units teach this
// standard?") and the /curriculum page ("which standards does this unit cover?").
//
// Inputs:  data/math/{nodes,relationships}.jsonl
// Output:  app/public/alignments.json

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'data', 'math');
const OUT_FILE = path.join(REPO, 'app', 'public', 'alignments.json');

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

const t0 = Date.now();

console.error('[1/3] Indexing LessonGrouping and CCSS-M Standard nodes...');
const units = new Map(); // id -> { shortId, name, courseCode }
const stds = new Map(); // id -> { code, grade, caseIdentifierUUID }
for await (const line of lines(path.join(SRC, 'nodes.jsonl'))) {
  const rec = JSON.parse(line);
  const labels = rec.labels || [];
  const p = rec.properties || {};
  if (labels.includes('LessonGrouping')) {
    units.set(rec.identifier, {
      id: rec.identifier,
      shortId: rec.identifier.replace(/^im:/, ''),
      name: p.name || null,
      courseCode: p.courseCode || null,
      ordinalName: p.ordinalName || null,
    });
  } else if (
    labels.includes('StandardsFrameworkItem') &&
    p.jurisdiction === 'Multi-State' &&
    p.academicSubject === 'Mathematics'
  ) {
    stds.set(rec.identifier, {
      id: rec.identifier,
      code: p.statementCode || null,
      caseIdentifierUUID: p.caseIdentifierUUID || null,
    });
  }
}
console.error(`  ${units.size} units, ${stds.size} CCSS-M standards`);

console.error('[2/3] Streaming hasEducationalAlignment edges...');
const unitToStandards = new Map(); // unitId -> [standard ids]
const standardToUnits = new Map(); // standardId -> [unit ids]
let edgeCount = 0;
for await (const line of lines(path.join(SRC, 'relationships.jsonl'))) {
  const r = JSON.parse(line);
  if (r.label !== 'hasEducationalAlignment') continue;
  if (!units.has(r.source_identifier)) continue;
  if (!stds.has(r.target_identifier)) continue;
  edgeCount++;
  pushMulti(unitToStandards, r.source_identifier, r.target_identifier);
  pushMulti(standardToUnits, r.target_identifier, r.source_identifier);
}
console.error(`  ${edgeCount} alignments kept`);

console.error('[3/3] Writing alignments.json...');

// Dedupe (the raw KG has a handful of duplicate edges between the same pair).
const unitToStdObj = {};
for (const [uid, sids] of unitToStandards) {
  const dedup = [...new Set(sids)];
  // Sort by code natural order so CCSS-M chips render predictably.
  dedup.sort((a, b) =>
    (stds.get(a)?.code || '').localeCompare(stds.get(b)?.code || '', undefined, { numeric: true }),
  );
  unitToStdObj[uid] = dedup.map((sid) => {
    const s = stds.get(sid);
    return {
      id: s.id,
      code: s.code,
      caseIdentifierUUID: s.caseIdentifierUUID,
    };
  });
}

const stdToUnitObj = {};
for (const [sid, uids] of standardToUnits) {
  const dedup = [...new Set(uids)];
  // Sort units by course order (K, 1, ..., HS), then by name.
  dedup.sort((a, b) => {
    const ua = units.get(a);
    const ub = units.get(b);
    const cd = courseRank(ua?.courseCode) - courseRank(ub?.courseCode);
    if (cd) return cd;
    return (ua?.name || '').localeCompare(ub?.name || '');
  });
  stdToUnitObj[sid] = dedup.map((uid) => {
    const u = units.get(uid);
    return {
      id: u.id,
      shortId: u.shortId,
      name: u.name,
      courseCode: u.courseCode,
      ordinalName: u.ordinalName,
    };
  });
}

const payload = {
  generatedAt: new Date().toISOString(),
  stats: {
    edges: edgeCount,
    units: Object.keys(unitToStdObj).length,
    standards: Object.keys(stdToUnitObj).length,
  },
  unitToStandards: unitToStdObj,
  standardToUnits: stdToUnitObj,
};
fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
console.error(`  wrote ${kb} KB to ${OUT_FILE}`);

console.error(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
