# Plan: Visualize Student Achievement Partners (SAP) Coherence Map

## Context

The repo already contains the raw ingredients for this work:

- `data/math/{nodes,relationships}.jsonl` — filtered CCSS-M subset of the Learning Commons Knowledge Graph (see `data/math/meta.json`: **757 `buildsTowards` edges**, which is exactly the relationship SAP's Coherence Map traverses).
- Working Next.js 15 + `vis-network` viewer under `app/`.
- Static-precompute pattern already in use: `scripts/build_subgraphs.mjs` → `app/public/subgraphs/<uuid>_{cur,nocur}.json`.
- Netlify static deploy configured (`netlify.toml`).

The Learning Commons MCP connector exposes the same traversal via `find_standards_progression_from_standard` (verified against `3.NF.A.1` → 2 backward, 7 forward — matches SAP expectations).

**Strategy:** hybrid — precompute the full coherence graph from local JSONL at build time, then use the MCP connector for on-demand side-panel enrichment.

## What we're visualizing

The SAP Coherence Map shows Common Core Math standards (K–HS) connected by `buildsTowards` edges, organized by **grade × domain × cluster** (e.g., `3.NF.A.1` → grade 3, domain NF, cluster 3.NF.A). In the KG these map to `StandardsFrameworkItem` nodes with `jurisdiction="Multi-State"`, `academicSubject="Mathematics"`, linked by the `buildsTowards` relationship.

## Data sources

### Static (build-time)
Full CCSS-M `buildsTowards` graph extracted from `data/math/*.jsonl`. Already downloaded; 757 edges. Drives the overview and is Netlify-static-safe.

### Live (on demand, via MCP connector)
Per-standard enrichment in the side panel:
- `find_standard_statement(code, jurisdiction?)` — official statement, grade, jurisdiction variants
- `find_standards_progression_from_standard(uuid, direction)` — authoritative prerequisites/subsequents (sanity-check + cross-jurisdiction equivalents)
- `find_learning_components_from_standard(uuid)` — finer-grained sub-skills for the "drill in" panel

## Phase 1 — Precompute the coherence graph

Add `scripts/build_coherence.mjs` (modeled on `build_subgraphs.mjs`):

1. Stream `data/math/nodes.jsonl`; keep CCSS-M Math `StandardsFrameworkItem`s. Derive `{grade, domain, cluster}` by parsing `statementCode` (e.g., `3.NF.A.1` → grade `3`, domain `NF`, cluster `3.NF.A`).
2. Stream `data/math/relationships.jsonl`; keep `buildsTowards` edges between kept nodes. Optionally include `relatesTo` / `mutuallyExclusiveWith` for richer connections.
3. Emit:
   - `app/public/coherence/graph.json` — full nodes + edges with grouping metadata (overview grid).
   - `app/public/coherence/focus/<uuid>.json` — per-standard ego network (ancestors + descendants, bounded hops) for fast focus view. Mirrors the existing `_cur.json`/`_nocur.json` convention.
   - `app/public/coherence/index.json` — code→uuid, grade/domain/cluster indices for search.

### How to test Phase 1

Data-only phase; no UI yet. Test with CLI + `jq`:

- **Build runs cleanly:** `node scripts/build_coherence.mjs` exits 0 and prints counts (nodes kept, edges kept, focus files written).
- **Edge count sanity:** `jq '.edges | length' app/public/coherence/graph.json` should be close to **757** (the `buildsTowards` total in `data/math/meta.json`). Large deviation = filter bug.
- **Node coverage:** `jq '.nodes | length' app/public/coherence/graph.json` should match the CCSS-M Math row (`jq 'select(.labels|index("StandardsFrameworkItem")) | select(.properties.jurisdiction=="Multi-State" and .properties.academicSubject=="Mathematics")' data/math/nodes.jsonl | wc -l`).
- **Grouping parse:** `jq '.nodes[] | select(.code=="3.NF.A.1") | {grade, domain, cluster}' app/public/coherence/graph.json` should give `{"3","NF","3.NF.A"}`. Also spot-check a messy code like `HSN-RN.A.1` or `K.CC.A.1`.
- **Focus file correctness** — this is the authoritative check against the connector:
  - Pick `3.NF.A.1`'s UUID (`6b9bf846-d7cc-11e8-824f-0242ac160002`).
  - `jq '.ancestors[].code' app/public/coherence/focus/6b9bf846-...json` should list exactly `2.MD.A.2`, `2.G.A.3`.
  - `jq '.descendants[].code' ...` should include `3.NF.A.3`, `3.G.A.2`, `4.NF.B.3.a`, `4.NF.B.3.b`, `4.NF.B.3.c`, `4.NF.B.4.a`, `5.NF.B.7`.
- **No dangling edges:** every edge's `source`/`target` must exist in `graph.json.nodes` (simple `jq` set-diff).
- **Index completeness:** `jq '.byCode | length' app/public/coherence/index.json` equals node count; random lookups return a UUID that exists.

## Phase 2 — Add a `/coherence` route

Create `app/src/app/coherence/page.tsx` with two synchronized views:

### Overview (canonical SAP layout)
A grade × domain grid, each cell listing that cluster's standards; arrows between cells represent cross-grade `buildsTowards` edges. Static, printable, matches achievethecore.org's visual model.

### Focus view
Clicking a standard loads `focus/<uuid>.json` into the existing `vis-network`-based `GraphViewer.tsx`, laid out with grade on the y-axis (hierarchical layout) so prerequisites sit below and subsequents above.

Reuse `components/GraphViewer.tsx`, `Legend.tsx`, `NodeDetail.tsx`. Add a small `CoherenceGrid.tsx` for the overview.

### How to test Phase 2

Visual + interaction testing in the browser:

- **Dev server:** `cd app && npm run dev`, open `http://localhost:3000/coherence`.
- **Overview grid renders:** grades K–HS on one axis, domains on the other; each cell lists cluster codes (e.g., `3.NF.A`) with the standards under them. No empty crash cells.
- **Edge rendering:** hovering or selecting a cluster highlights cross-grade arrows into/out of it. Arrow direction points from earlier grade to later grade.
- **Focus view loads:** click `3.NF.A.1` → focus view mounts, shows `2.MD.A.2` + `2.G.A.3` below it and the ~7 forward standards above. Nothing else.
- **Layout sanity:** grade-y-axis layout means no descendant ever sits below its prerequisite.
- **Back/forward:** `/coherence?focus=3.NF.A.1` deep-links to the focus view and reloads cleanly.
- **Static build:** `npm run build && npm run start` serves the same page with no runtime errors (confirms the JSONs under `app/public/coherence/` are picked up as static assets).
- **Regression check on existing viewer:** open the pre-existing `/` and `/documents` routes — they should still render (we haven't broken the shared `GraphViewer.tsx`).
- **Mobile-ish viewport:** resize to ~768px wide; grid scrolls, focus graph remains usable.

## Phase 3 — Wire the connector for side-panel enrichment

Add a Next.js route handler (`app/src/app/api/standard/[code]/route.ts`) that calls the MCP tools server-side. For the focused standard, return:

- canonical statement (+ Maryland/California/etc. variants if the user selects a jurisdiction),
- live backward/forward progression (used as "source of truth" check vs. our precomputed edges — flag mismatches),
- learning components.

Render this in `NodeDetail.tsx`. This combines the scale of a static map with the authority of the connector at the point of inspection.

**Deployment note:** Netlify's current static export won't host route handlers. Two options:
- **(a) Recommended:** flip this one page to SSR on Netlify Functions — less custom glue.
- (b) Keep fully static and have connector calls happen client-side through a small MCP bridge.

### How to test Phase 3

End-to-end with real connector calls:

- **Route handler smoke test:** `curl -s http://localhost:3000/api/standard/3.NF.A.1 | jq` returns a JSON envelope with `statement`, `backward`, `forward`, and `learningComponents` keys. No empty objects.
- **Statement correctness:** the `statement` field matches what `find_standard_statement` returns for `3.NF.A.1` (contains "partition" and "equal parts"). Try with `?jurisdiction=Maryland` to confirm jurisdiction variants round-trip.
- **Cross-check live vs. precomputed:** the live `backward` array from the connector equals the `ancestors` array in the precomputed focus file for the same standard. If they diverge, the UI should show a "⚠ precomputed graph drifted from source" flag — force this by temporarily hand-editing the focus JSON and confirm the flag appears.
- **Learning components:** for `3.NF.A.1`, `learningComponents` should contain the two components we saw during planning (descriptions mention "fraction a/b" and "fraction 1/b" with b ∈ {2,3,4,6,8}).
- **Side panel rendering:** click a node in the focus view; the side panel populates within ~1s, renders the statement (with LaTeX fractions intact), lists prerequisites/subsequents as clickable chips, and shows learning components.
- **Error paths:** hit `/api/standard/BOGUS.1.1` — side panel shows a clean error state, not a blank panel or a crash.
- **Netlify preview:** deploy a preview branch and hit the same `/api/standard/*` path against Netlify Functions. Watch the function log for cold-start time and MCP auth errors.
- **Performance sanity:** 10 rapid clicks across nodes → no duplicate in-flight requests (client should cache or debounce).

## Phase 4 — UX details for SAP fidelity

- Color-encode by domain (NBT, NF, OA, MD, G, RP, SP, EE, F, NS) — matches SAP's palette convention.
- Edge direction: prerequisite → target (arrowhead points up in grade).
- "Unfinished learning" mode: given a target standard, dim everything except ancestors within 2 grades (per SAP's explicit guidance from the connector's tool description — don't send students >2 grades back).
- Search by code (`3.NF.A.1`) or keyword; deep-linkable via `/coherence?focus=<code>`.

### How to test Phase 4

Mostly visual, but with concrete criteria:

- **Domain coloring:** all 10 domains render in visually distinct colors; side-by-side check against achievethecore.org's SAP map shows the same domain groupings (doesn't have to match hex-for-hex, just be semantically clustered).
- **Edge direction:** pick any edge in the focus view; the node at the arrow's *tail* has a lower grade than the node at its *head*. Also verify in the overview grid that no arrow points "down" in grade.
- **Unfinished-learning mode:** toggle on with target = `5.NF.B.7` (grade 5). Nothing from grade 2 or below should remain highlighted; grades 3–4 prerequisites stay visible; grade-5 peers stay visible. Toggle off → everything comes back.
- **Search — exact code:** type `3.NF.A.1` → focus view opens on that node; URL becomes `/coherence?focus=3.NF.A.1`.
- **Search — keyword:** type `fraction` → dropdown surfaces `3.NF.*`, `4.NF.*`, `5.NF.*` entries with their descriptions; clicking focuses that node.
- **Deep link reload:** copy the URL after a focus, paste in a fresh tab → same view, no flicker of a default state.
- **Accessibility sanity:** tab through the grid — focus outlines visible; arrow keys or Enter open the focus view; domain colors have a non-color differentiator (label or shape) for colorblind users.

## Phase 5 — Verification

Spot-checks against connector ground truth:

- `3.NF.A.1`: backward = {`2.MD.A.2`, `2.G.A.3`}; forward includes `3.NF.A.3`, `3.G.A.2`, `4.NF.B.3.a/b/c`, `4.NF.B.4.a`, `5.NF.B.7` (verified via connector during planning).
- Grade-to-grade edge counts should roughly match SAP's published map.
- Orphan check: any Multi-State Math standard with zero in/out `buildsTowards` surfaces in a "disconnected" list for review.

### How to test Phase 5

This phase *is* the testing, so formalize it as a script + checklist:

- **Automated comparator:** add `scripts/verify_coherence.mjs` that picks ~20 representative standards across grades (K.CC.A.1, 2.OA.A.1, 3.NF.A.1, 4.NF.B.3.a, 5.NF.B.7, 6.RP.A.1, 7.EE.B.3, 8.F.A.1, HSA-REI.B.3, MP1, …), calls `find_standards_progression_from_standard` for each (both directions), and diffs the result against our precomputed focus JSONs. Pass = zero diffs.
- **Report format:** script prints a table of `code | missing-in-precomputed | extra-in-precomputed`. Any non-empty cell = investigate before shipping.
- **Grade-transition histogram:** `jq` over `graph.json.edges` grouped by `{fromGrade, toGrade}` → expect the bulk of edges to span adjacent grades (diff = 1). Edges spanning 3+ grades flagged for manual review (legitimate cases exist, but they're rare on the SAP map).
- **Orphan list:** `scripts/verify_coherence.mjs` also prints standards with degree 0. Compare against SAP's published map; standards like MP (Mathematical Practices) are expected orphans — record them as an allowlist so future runs don't re-flag.
- **Visual A/B:** open `/coherence` next to achievethecore.org's SAP map; pick 3 clusters at random and confirm the incoming/outgoing arrows match.

## Phase 6 — Stretch

- Cross-jurisdiction toggle (re-label nodes using `find_standard_statement` with a chosen state).
- Overlay `LearningComponent` nodes on a standard to expand into teachable sub-skills.
- Show `Activity`/`Lesson` counts per standard (the KG has `hasStandardAlignment` edges; `meta.json` confirms ~20k).

### How to test Phase 6

Each stretch item is independently testable:

- **Cross-jurisdiction toggle:**
  - Select "Maryland"; verify `3.NF.A.1`'s label reflects the Maryland-adopted wording (call `find_standard_statement('3.NF.A.1', 'Maryland')` in a terminal and compare).
  - Switch to a state not in the supported list (e.g., "Alaska") → UI either disables the toggle or shows "no MD-derived mapping" cleanly, no crash.
  - Graph structure stays the same when switching; only node labels update.
- **Learning components overlay:**
  - Focus on `3.NF.A.1`, click "show learning components" → 2 LC nodes appear attached to it (matches the connector response from planning).
  - Clicking an LC node opens a sub-panel with its description; no further traversal (LCs are leaves here).
  - Toggle off → LCs disappear, standards view is clean.
- **Activity/Lesson counts:**
  - Build-time: augment `build_coherence.mjs` to count `hasStandardAlignment` inbound edges from `Activity`/`Lesson` nodes per standard.
  - `jq '.nodes[] | {code, activityCount, lessonCount}' app/public/coherence/graph.json | head` → nonzero for common standards (e.g., `3.NF.A.1`).
  - Grand total of `activityCount` across all nodes ≈ the `hasStandardAlignment` count in `meta.json` (~20,548), modulo the CCSS-M filter.
  - Badges render on nodes in overview; hovering shows tooltip with exact counts.

## Suggested starting point

Phases 1 and 2 are independent of the connector-runtime decision and get a working map visible fastest. Start there.
