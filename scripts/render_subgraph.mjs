#!/usr/bin/env node
// Render a filtered slice of the Knowledge Graph as a standalone HTML file
// using vis-network (loaded from CDN inside the emitted page).

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const DATA = path.join(REPO, 'data');

function parseArgs(argv) {
  const args = {
    jurisdiction: null,
    subject: null,
    includeCurriculum: false,
    maxNodes: 5000,
    out: path.join(DATA, 'graph.html'),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--framework' || a === '--jurisdiction') args.jurisdiction = argv[++i];
    else if (a === '--subject') args.subject = argv[++i];
    else if (a === '--include-curriculum') args.includeCurriculum = true;
    else if (a === '--max-nodes') args.maxNodes = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        `Usage: node render_subgraph.mjs --framework <jurisdiction> --subject <subject> [--include-curriculum] [--max-nodes N] [--out path]\n` +
        `Example: node render_subgraph.mjs --framework California --subject Mathematics`
      );
      process.exit(0);
    }
  }
  if (!args.jurisdiction || !args.subject) {
    console.error('Error: --framework (jurisdiction) and --subject are required');
    process.exit(1);
  }
  return args;
}

async function* streamLines(filepath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filepath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line) yield line;
}

async function findFramework(nodesPath, jurisdiction, subject) {
  for await (const line of streamLines(nodesPath)) {
    const rec = JSON.parse(line);
    if (!rec.labels?.includes('StandardsFramework')) continue;
    const p = rec.properties || {};
    if (p.jurisdiction === jurisdiction && p.academicSubject === subject) return rec;
  }
  return null;
}

async function buildRelIndex(relsPath, wantCurriculum) {
  const hasChild = new Map();        // parent_id -> [child_id]
  const curriculumFor = new Map();    // sfi_id -> [curriculum_id]  via hasEducationalAlignment
  const supportsFor = new Map();      // sfi_id -> [lc_id]           via supports
  const hasPart = new Map();          // parent_id -> [child_id]     for curriculum containment

  const push = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

  for await (const line of streamLines(relsPath)) {
    const rec = JSON.parse(line);
    const lbl = rec.label;
    if (lbl === 'hasChild') push(hasChild, rec.source_identifier, rec.target_identifier);
    else if (!wantCurriculum) continue;
    else if (lbl === 'hasEducationalAlignment') push(curriculumFor, rec.target_identifier, rec.source_identifier);
    else if (lbl === 'supports') push(supportsFor, rec.target_identifier, rec.source_identifier);
    else if (lbl === 'hasPart') push(hasPart, rec.source_identifier, rec.target_identifier);
  }
  return { hasChild, curriculumFor, supportsFor, hasPart };
}

function bfs(adj, start, cap) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length && seen.size < cap) {
    const cur = queue.shift();
    for (const nxt of adj.get(cur) || []) {
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      queue.push(nxt);
      if (seen.size >= cap) break;
    }
  }
  return seen;
}

async function fetchNodeProperties(nodesPath, ids) {
  const out = new Map();
  for await (const line of streamLines(nodesPath)) {
    const rec = JSON.parse(line);
    if (ids.has(rec.identifier)) {
      out.set(rec.identifier, rec);
      if (out.size === ids.size) break;
    }
  }
  return out;
}

async function collectEdges(relsPath, ids) {
  const edges = [];
  for await (const line of streamLines(relsPath)) {
    const rec = JSON.parse(line);
    if (ids.has(rec.source_identifier) && ids.has(rec.target_identifier)) {
      edges.push(rec);
    }
  }
  return edges;
}

const LABEL_COLORS = {
  StandardsFramework: '#d13434',
  StandardsFrameworkItem: '#4a90e2',
  LearningComponent: '#9b59b6',
  Course: '#16a085',
  LessonGrouping: '#1abc9c',
  Lesson: '#2ecc71',
  Activity: '#f39c12',
  Assessment: '#e67e22',
};
const EDGE_COLORS = {
  hasChild: '#bdc3c7',
  hasPart: '#7f8c8d',
  hasEducationalAlignment: '#3498db',
  supports: '#9b59b6',
  hasStandardAlignment: '#e74c3c',
  buildsTowards: '#f1c40f',
  hasReference: '#34495e',
  relatesTo: '#95a5a6',
  hasDependency: '#c0392b',
  mutuallyExclusiveWith: '#8e44ad',
};

function nodeLabel(rec) {
  const p = rec.properties || {};
  if (rec.labels.includes('StandardsFramework')) return p.name || p.jurisdiction || '';
  if (rec.labels.includes('StandardsFrameworkItem')) return p.statementCode || (p.identifier || '').slice(0, 8);
  return p.name || p.ordinalName || (p.identifier || '').slice(0, 8);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nodeTitle(rec) {
  const p = rec.properties || {};
  const parts = [`<b>${escapeHtml(rec.labels.join(', '))}</b>`];
  if (p.statementCode) parts.push(`<b>${escapeHtml(p.statementCode)}</b>`);
  if (p.name) parts.push(escapeHtml(p.name));
  if (p.description) {
    const d = p.description.length > 280 ? p.description.slice(0, 280) + '…' : p.description;
    parts.push(escapeHtml(d));
  }
  if (p.gradeLevel) parts.push(`Grade: ${escapeHtml(p.gradeLevel)}`);
  if (p.jurisdiction) parts.push(`Jurisdiction: ${escapeHtml(p.jurisdiction)}`);
  if (p.academicSubject) parts.push(`Subject: ${escapeHtml(p.academicSubject)}`);
  return parts.join('<br>');
}

function buildHtml({ nodes, edges, title, stats }) {
  const visNodes = [...nodes.values()].map(rec => {
    const primary = rec.labels[0];
    return {
      id: rec.identifier,
      label: nodeLabel(rec).slice(0, 40),
      title: nodeTitle(rec),
      color: LABEL_COLORS[primary] || '#777',
      group: primary,
      shape: primary === 'StandardsFramework' ? 'star' : 'dot',
      size: primary === 'StandardsFramework' ? 30 : primary === 'Course' ? 22 : primary === 'LessonGrouping' ? 16 : 10,
    };
  });
  const visEdges = edges.map((rec, i) => ({
    id: rec.identifier || `e${i}`,
    from: rec.source_identifier,
    to: rec.target_identifier,
    color: { color: EDGE_COLORS[rec.label] || '#ccc', opacity: 0.6 },
    title: rec.label,
    arrows: 'to',
    width: rec.label === 'hasChild' ? 0.5 : 1.2,
    smooth: false,
  }));

  const legendLabels = Object.entries(LABEL_COLORS)
    .map(([k, v]) => `<div><span class="sw" style="background:${v}"></span>${k}</div>`).join('');
  const legendEdges = Object.entries(EDGE_COLORS)
    .map(([k, v]) => `<div><span class="sw bar" style="background:${v}"></span>${k}</div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<script src="https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, -apple-system, sans-serif; }
  #header { position: absolute; top: 10px; left: 10px; background: rgba(255,255,255,0.95); padding: 10px 14px; border-radius: 6px; z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,0.15); max-width: 340px; }
  #header h1 { margin: 0 0 4px 0; font-size: 14px; }
  #header .stats { font-size: 12px; color: #555; }
  #legend { position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.95); padding: 10px 14px; border-radius: 6px; z-index: 10; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.15); max-height: 90vh; overflow: auto; }
  #legend h3 { margin: 0 0 4px 0; font-size: 11px; color: #555; text-transform: uppercase; }
  #legend div { margin: 2px 0; }
  #legend .sw { display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: middle; border-radius: 2px; }
  #legend .bar { height: 3px; }
  #network { width: 100vw; height: 100vh; background: #fafafa; }
  input[type="text"] { padding: 4px 6px; width: 100%; box-sizing: border-box; margin-top: 6px; border: 1px solid #ccc; border-radius: 3px; }
  #detail { position: absolute; bottom: 10px; left: 10px; background: rgba(255,255,255,0.95); padding: 10px 14px; border-radius: 6px; z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,0.15); max-width: 520px; max-height: 40vh; overflow: auto; font-size: 12px; display: none; }
</style>
</head>
<body>
<div id="header">
  <h1>${escapeHtml(title)}</h1>
  <div class="stats">${stats}</div>
  <input type="text" id="q" placeholder="Filter by label (e.g. 3.NF.A.1)">
</div>
<div id="legend">
  <h3>Nodes</h3>${legendLabels}
  <h3 style="margin-top:8px">Edges</h3>${legendEdges}
</div>
<div id="network"></div>
<div id="detail"></div>
<script>
const rawNodes = ${JSON.stringify(visNodes)};
const rawEdges = ${JSON.stringify(visEdges)};
const nodes = new vis.DataSet(rawNodes);
const edges = new vis.DataSet(rawEdges);
const container = document.getElementById('network');
const options = {
  physics: {
    solver: 'forceAtlas2Based',
    forceAtlas2Based: { gravitationalConstant: -60, springLength: 120, springConstant: 0.06, avoidOverlap: 0.6 },
    stabilization: { iterations: 200 },
    timestep: 0.5
  },
  nodes: { font: { size: 11, face: 'system-ui' }, borderWidth: 1 },
  edges: { arrows: { to: { scaleFactor: 0.4 } }, selectionWidth: 2 },
  interaction: { hover: true, tooltipDelay: 120, hideEdgesOnDrag: true, navigationButtons: true, keyboard: true }
};
const network = new vis.Network(container, { nodes, edges }, options);

const detail = document.getElementById('detail');
network.on('selectNode', e => {
  const n = nodes.get(e.nodes[0]);
  if (!n) return;
  detail.innerHTML = n.title;
  detail.style.display = 'block';
});
network.on('deselectNode', () => { detail.style.display = 'none'; });

document.getElementById('q').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const updates = rawNodes.map(n => ({
    id: n.id,
    hidden: q ? !String(n.label || '').toLowerCase().includes(q) : false
  }));
  nodes.update(updates);
});
</script>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  const nodesPath = path.join(DATA, 'nodes.jsonl');
  const relsPath = path.join(DATA, 'relationships.jsonl');
  for (const p of [nodesPath, relsPath]) {
    if (!fs.existsSync(p)) { console.error(`Missing ${p}`); process.exit(1); }
  }

  const t0 = Date.now();
  console.error(`[1/5] Finding StandardsFramework jurisdiction="${args.jurisdiction}" subject="${args.subject}"...`);
  const framework = await findFramework(nodesPath, args.jurisdiction, args.subject);
  if (!framework) {
    console.error(`  no match found`);
    process.exit(1);
  }
  console.error(`      -> ${framework.properties.name || framework.identifier}`);

  console.error(`[2/5] Indexing relationships${args.includeCurriculum ? ' (incl. curriculum)' : ''}...`);
  const idx = await buildRelIndex(relsPath, args.includeCurriculum);
  console.error(`      hasChild parents=${idx.hasChild.size}` +
    (args.includeCurriculum ? `, curriculumFor=${idx.curriculumFor.size}, supportsFor=${idx.supportsFor.size}, hasPart=${idx.hasPart.size}` : ''));

  console.error(`[3/5] BFS from framework through hasChild...`);
  const selected = bfs(idx.hasChild, framework.identifier, args.maxNodes);
  console.error(`      ${selected.size} standards nodes selected`);

  if (args.includeCurriculum) {
    const before = selected.size;
    // Add one LearningComponent per selected SFI (via supports)
    for (const sfi of [...selected]) {
      if (selected.size >= args.maxNodes) break;
      for (const lc of idx.supportsFor.get(sfi) || []) {
        if (selected.size >= args.maxNodes) break;
        selected.add(lc);
      }
    }
    // Add curriculum nodes aligned to selected SFIs (via hasEducationalAlignment)
    const curriculumSeeds = [];
    for (const sfi of selected) {
      for (const c of idx.curriculumFor.get(sfi) || []) curriculumSeeds.push(c);
    }
    for (const seed of curriculumSeeds) {
      if (selected.size >= args.maxNodes) break;
      selected.add(seed);
    }
    // Walk hasPart one level down from each seed (Lesson -> Activity/Assessment)
    for (const seed of curriculumSeeds) {
      if (selected.size >= args.maxNodes) break;
      for (const child of idx.hasPart.get(seed) || []) {
        if (selected.size >= args.maxNodes) break;
        selected.add(child);
      }
    }
    console.error(`      +${selected.size - before} curriculum/LC nodes (cap=${args.maxNodes})`);
  }

  console.error(`[4/5] Fetching node properties...`);
  const nodeMap = await fetchNodeProperties(nodesPath, selected);

  console.error(`[5/5] Collecting edges and writing HTML...`);
  const edgeList = await collectEdges(relsPath, selected);

  const title = `${args.jurisdiction} ${args.subject}${args.includeCurriculum ? ' + curriculum' : ''}`;
  const stats = `${nodeMap.size} nodes · ${edgeList.length} edges · generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const html = buildHtml({ nodes: nodeMap, edges: edgeList, title, stats });
  fs.writeFileSync(args.out, html);
  console.error(`Done: ${args.out}`);
  console.error(stats);
}

main().catch(err => { console.error(err); process.exit(1); });
