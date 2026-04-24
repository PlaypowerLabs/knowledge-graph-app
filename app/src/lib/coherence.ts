// Types and helpers shared by the /coherence route.
// All shapes here match what `scripts/build_coherence.mjs` writes into
// `app/public/coherence/`.

export type CoherenceLevel = 'standard' | 'substandard' | 'cluster' | 'domain';

export type CoherenceNode = {
  id: string;
  caseIdentifierUUID: string | null;
  code: string | null;
  description: string | null;
  statementType: string | null;
  gradeLevels: string[];
  grade: string | null;
  domain: string | null;
  cluster: string | null;
  level: CoherenceLevel | null;
};

export type CoherenceEdge = {
  id: string;
  label: 'buildsTowards' | 'relatesTo' | 'mutuallyExclusiveWith';
  source: string;
  target: string;
};

export type CoherenceGraph = {
  generatedAt: string;
  nodes: CoherenceNode[];
  edges: CoherenceEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    edgesByLabel: Record<string, number>;
  };
};

export type CoherenceFocus = {
  focus: CoherenceNode;
  ancestors: CoherenceNode[];
  descendants: CoherenceNode[];
  edges: CoherenceEdge[];
  stats: {
    ancestorCount: number;
    descendantCount: number;
    edgeCount: number;
  };
};

export type CoherenceIndex = {
  generatedAt: string;
  byCode: Record<string, string>; // code -> caseIdentifierUUID
  byUuid: Record<
    string,
    Pick<CoherenceNode, 'id' | 'code' | 'grade' | 'domain' | 'cluster' | 'level'>
  >;
  grades: string[];
  domains: string[];
  clustersByGrade: Record<string, string[]>;
};

export const GRADE_ORDER = ['K', '1', '2', '3', '4', '5', '6', '7', '8', 'HS'] as const;

export function gradeRank(g: string | null | undefined): number {
  if (g == null) return 99;
  const i = GRADE_ORDER.indexOf(g as (typeof GRADE_ORDER)[number]);
  return i === -1 ? 99 : i;
}

// Domain palette chosen to match SAP's semantic groupings: K-8 domains get
// warm-to-cool progression; HS conceptual-category prefixes (N-, A-, F-, G-, S-)
// share a family so the eye clusters them; MP sits neutral.
export const DOMAIN_COLORS: Record<string, string> = {
  // K-8
  CC: '#2563eb', // counting & cardinality — blue
  OA: '#059669', // operations & algebraic thinking — green
  NBT: '#d97706', // number & ops in base ten — amber
  NF: '#7c3aed', // number & ops fractions — purple
  MD: '#b45309', // measurement & data — brown
  G: '#db2777', // geometry — pink
  RP: '#0891b2', // ratios & proportional relationships — teal
  EE: '#c026d3', // expressions & equations — magenta
  F: '#16a34a', // functions (gr 8) — green
  NS: '#0284c7', // number system (gr 6-8) — blue
  SP: '#64748b', // statistics & probability — slate
  // HS conceptual categories (N-, A-, F-, G-, S-) — families
  'N-RN': '#1d4ed8',
  'N-Q': '#2563eb',
  'N-CN': '#3b82f6',
  'N-VM': '#60a5fa',
  'A-SSE': '#b91c1c',
  'A-APR': '#dc2626',
  'A-CED': '#ef4444',
  'A-REI': '#f87171',
  'F-IF': '#15803d',
  'F-BF': '#16a34a',
  'F-LE': '#22c55e',
  'F-TF': '#4ade80',
  'G-CO': '#c2410c',
  'G-SRT': '#ea580c',
  'G-C': '#f97316',
  'G-GPE': '#fb923c',
  'G-GMD': '#fdba74',
  'G-MG': '#fed7aa',
  'S-ID': '#6d28d9',
  'S-IC': '#7c3aed',
  'S-CP': '#8b5cf6',
  'S-MD': '#a78bfa',
  // Mathematical Practices
  MP: '#475569',
};

export function domainColor(domain: string | null | undefined): string {
  if (!domain) return '#94a3b8';
  return DOMAIN_COLORS[domain] || '#94a3b8';
}

// Short human-readable name for a domain code — used in legends and tooltips.
export const DOMAIN_NAMES: Record<string, string> = {
  CC: 'Counting & Cardinality',
  OA: 'Operations & Algebraic Thinking',
  NBT: 'Number & Operations in Base Ten',
  NF: 'Number & Operations — Fractions',
  MD: 'Measurement & Data',
  G: 'Geometry',
  RP: 'Ratios & Proportional Relationships',
  EE: 'Expressions & Equations',
  F: 'Functions',
  NS: 'The Number System',
  SP: 'Statistics & Probability',
  'N-RN': 'The Real Number System',
  'N-Q': 'Quantities',
  'N-CN': 'The Complex Number System',
  'N-VM': 'Vector & Matrix Quantities',
  'A-SSE': 'Seeing Structure in Expressions',
  'A-APR': 'Arithmetic with Polynomials & Rational Expressions',
  'A-CED': 'Creating Equations',
  'A-REI': 'Reasoning with Equations & Inequalities',
  'F-IF': 'Interpreting Functions',
  'F-BF': 'Building Functions',
  'F-LE': 'Linear, Quadratic & Exponential Models',
  'F-TF': 'Trigonometric Functions',
  'G-CO': 'Congruence',
  'G-SRT': 'Similarity, Right Triangles & Trigonometry',
  'G-C': 'Circles',
  'G-GPE': 'Expressing Geometric Properties with Equations',
  'G-GMD': 'Geometric Measurement & Dimension',
  'G-MG': 'Modeling with Geometry',
  'S-ID': 'Interpreting Categorical & Quantitative Data',
  'S-IC': 'Making Inferences & Justifying Conclusions',
  'S-CP': 'Conditional Probability & Rules of Probability',
  'S-MD': 'Using Probability to Make Decisions',
  MP: 'Mathematical Practices',
};

export function domainName(domain: string | null | undefined): string {
  if (!domain) return '';
  return DOMAIN_NAMES[domain] || domain;
}

// Bucket a set of nodes into `grade -> cluster -> node[]` for the overview grid.
export function bucketByGradeCluster(
  nodes: CoherenceNode[],
): Map<string, Map<string, CoherenceNode[]>> {
  const out = new Map<string, Map<string, CoherenceNode[]>>();
  for (const n of nodes) {
    if (!n.grade || !n.cluster) continue;
    // Skip structural / header nodes in the canonical SAP grid view. Clusters
    // and domain headers serve as labels for the cells, not as cell contents.
    if (n.level === 'cluster' || n.level === 'domain') continue;
    let byCluster = out.get(n.grade);
    if (!byCluster) {
      byCluster = new Map();
      out.set(n.grade, byCluster);
    }
    let arr = byCluster.get(n.cluster);
    if (!arr) {
      arr = [];
      byCluster.set(n.cluster, arr);
    }
    arr.push(n);
  }
  // Sort standards inside each cluster by code (natural order).
  for (const byCluster of out.values()) {
    for (const arr of byCluster.values()) {
      arr.sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }));
    }
  }
  return out;
}

// Strip TeX-like markup from a standard description for plain-text preview.
// Full LaTeX rendering happens elsewhere (side panel); this is for tight UIs.
export function plainifyDescription(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\$+/g, '')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2')
    .replace(/\\times/g, '×')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
