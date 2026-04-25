// Types for the IM-unit ↔ CCSS-M standard alignment map.
// Shape matches `scripts/build_alignments.mjs` output in
// `app/public/alignments.json`.

export type AlignedStandard = {
  id: string;               // StandardsFrameworkItem node identifier
  code: string | null;      // e.g. "HSG-SRT.C.8"
  caseIdentifierUUID: string | null;
};

export type AlignedUnit = {
  id: string;               // LessonGrouping node identifier (prefixed `im:`)
  shortId: string;          // id without the `im:` prefix
  name: string | null;
  courseCode: string | null;
  ordinalName: string | null;
};

export type Alignments = {
  generatedAt: string;
  stats: { edges: number; units: number; standards: number };
  // unit id -> standards it covers
  unitToStandards: Record<string, AlignedStandard[]>;
  // standard id -> units that teach it
  standardToUnits: Record<string, AlignedUnit[]>;
};
