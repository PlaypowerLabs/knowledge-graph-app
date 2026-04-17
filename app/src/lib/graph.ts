// Server-side graph loader and subgraph extractor.
// Loads the Math-only JSONL files from ../data/math/ on first use, caches in memory.

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

export type NodeRec = {
  identifier: string;
  labels: string[];
  properties: Record<string, unknown>;
};

export type RelRec = {
  identifier?: string;
  label: string;
  properties: Record<string, unknown>;
  source_identifier: string;
  source_labels: string[];
  target_identifier: string;
  target_labels: string[];
};

export type GraphCache = {
  nodes: Map<string, NodeRec>;
  edgesByLabel: Map<string, RelRec[]>;
  frameworks: NodeRec[];
  meta: unknown;
};

const DATA_DIR = path.resolve(process.cwd(), '..', 'data', 'math');

let cache: GraphCache | null = null;
let loading: Promise<GraphCache> | null = null;

async function* streamLines(filepath: string) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filepath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line) yield line;
}

export async function loadGraph(): Promise<GraphCache> {
  if (cache) return cache;
  if (loading) return loading;

  loading = (async () => {
    const nodes = new Map<string, NodeRec>();
    const frameworks: NodeRec[] = [];

    for await (const line of streamLines(path.join(DATA_DIR, 'nodes.jsonl'))) {
      const rec = JSON.parse(line) as NodeRec;
      nodes.set(rec.identifier, rec);
      if (rec.labels.includes('StandardsFramework')) frameworks.push(rec);
    }

    const edgesByLabel = new Map<string, RelRec[]>();
    for await (const line of streamLines(path.join(DATA_DIR, 'relationships.jsonl'))) {
      const rec = JSON.parse(line) as RelRec;
      const arr = edgesByLabel.get(rec.label);
      if (arr) arr.push(rec);
      else edgesByLabel.set(rec.label, [rec]);
    }

    let meta: unknown = null;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'meta.json'), 'utf-8'));
    } catch {
      /* optional */
    }

    frameworks.sort((a, b) => {
      const ja = String(a.properties.jurisdiction || '');
      const jb = String(b.properties.jurisdiction || '');
      return ja.localeCompare(jb);
    });

    cache = { nodes, edgesByLabel, frameworks, meta };
    return cache;
  })();
  return loading;
}

function pushMulti<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function buildAdj(edges: RelRec[] | undefined): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const rec of edges || []) pushMulti(m, rec.source_identifier, rec.target_identifier);
  return m;
}

function buildReverseAdj(edges: RelRec[] | undefined): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const rec of edges || []) pushMulti(m, rec.target_identifier, rec.source_identifier);
  return m;
}

function bfs(adj: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nxt of adj.get(cur) || []) {
      if (seen.has(nxt)) continue;
      seen.add(nxt);
      queue.push(nxt);
    }
  }
  return seen;
}

export type SubgraphOpts = {
  frameworkIdentifier: string;
  includeCurriculum?: boolean;
};

export async function getSubgraph(opts: SubgraphOpts) {
  const { frameworkIdentifier, includeCurriculum = false } = opts;
  const g = await loadGraph();

  const hasChildAdj = buildAdj(g.edgesByLabel.get('hasChild'));
  const selected = bfs(hasChildAdj, frameworkIdentifier);

  if (includeCurriculum) {
    const supportsFor = buildReverseAdj(g.edgesByLabel.get('supports'));
    const curriculumFor = buildReverseAdj(g.edgesByLabel.get('hasEducationalAlignment'));
    const hasPartAdj = buildAdj(g.edgesByLabel.get('hasPart'));

    for (const sfi of [...selected]) {
      for (const lc of supportsFor.get(sfi) || []) selected.add(lc);
    }

    const seeds: string[] = [];
    for (const sfi of selected) {
      for (const c of curriculumFor.get(sfi) || []) seeds.push(c);
    }
    for (const s of seeds) selected.add(s);
    for (const s of seeds) {
      for (const child of hasPartAdj.get(s) || []) selected.add(child);
    }
  }

  const outNodes: NodeRec[] = [];
  for (const id of selected) {
    const n = g.nodes.get(id);
    if (n) outNodes.push(n);
  }

  const outEdges: RelRec[] = [];
  for (const edges of g.edgesByLabel.values()) {
    for (const rec of edges) {
      if (selected.has(rec.source_identifier) && selected.has(rec.target_identifier)) {
        outEdges.push(rec);
      }
    }
  }

  return { nodes: outNodes, edges: outEdges };
}
