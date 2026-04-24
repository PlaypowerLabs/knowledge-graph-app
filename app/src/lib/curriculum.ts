// Types and helpers for the /curriculum route (IM 360 hasDependency map).
// Shapes match `scripts/build_curriculum.mjs` output in app/public/curriculum/.

export type CurriculumNode = {
  id: string;
  shortId: string;
  name: string | null;
  ordinalName: string | null;
  position: number;
  courseCode: string | null;
  band: 'Elementary' | 'Middle' | 'High' | null;
  gradeLevels: string[];
  timeRequired: string | null;
  curriculumLabel: string | null;
  groupLevel: number;
  author: string | null;
  dateCreated: string | null;
};

export type CurriculumEdge = {
  id: string;
  label: 'hasDependency';
  // After the source/target flip in build_curriculum.mjs:
  //   source = prerequisite unit, target = dependent unit.
  source: string;
  target: string;
};

export type CurriculumGraph = {
  generatedAt: string;
  nodes: CurriculumNode[];
  edges: CurriculumEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    edgesByLabel: Record<string, number>;
  };
};

export type CurriculumFocus = {
  focus: CurriculumNode;
  ancestors: CurriculumNode[]; // prerequisite units (transitive)
  descendants: CurriculumNode[]; // dependent units (transitive)
  edges: CurriculumEdge[];
  stats: {
    ancestorCount: number;
    descendantCount: number;
    edgeCount: number;
  };
};

export type CurriculumIndex = {
  generatedAt: string;
  byId: Record<
    string,
    {
      id: string;
      shortId: string;
      name: string | null;
      ordinalName: string | null;
      courseCode: string | null;
      band: CurriculumNode['band'];
      position: number;
    }
  >;
  byShortId: Record<string, string>; // shortId -> full id
  courses: string[];
  bands: Array<'Elementary' | 'Middle' | 'High'>;
  unitsByCourse: Record<
    string,
    Array<{
      id: string;
      shortId: string;
      name: string | null;
      ordinalName: string | null;
      position: number;
    }>
  >;
};

// Band colors mirror the SAP palette's tone (neutral, not competing with it).
export const BAND_COLORS: Record<string, string> = {
  Elementary: '#0891b2',
  Middle: '#d97706',
  High: '#7c3aed',
};

export function bandColor(band: string | null | undefined): string {
  if (!band) return '#94a3b8';
  return BAND_COLORS[band] || '#94a3b8';
}

// Strip the `im360:` prefix for display. `im360:Alg1+` → `Alg1+`.
export function prettyCourse(code: string | null | undefined): string {
  if (!code) return '';
  return code.replace(/^im360:/, '');
}

// IM 360 courses, ordered for the grid columns.
export const COURSE_ORDER = [
  'im360:K', 'im360:1', 'im360:2', 'im360:3', 'im360:4', 'im360:5',
  'im360:6', 'im360:7', 'im360:8', 'im360:Acc6', 'im360:Acc7',
  'im360:Alg1', 'im360:Alg1+', 'im360:Alg2', 'im360:Geo',
  'im360:Math1', 'im360:Math2', 'im360:Math3',
];

export function courseRank(code: string | null | undefined): number {
  if (!code) return 99;
  const i = COURSE_ORDER.indexOf(code);
  return i === -1 ? 99 : i;
}
