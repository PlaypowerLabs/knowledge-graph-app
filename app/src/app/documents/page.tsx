import Link from 'next/link';

export const metadata = {
  title: 'Knowledge Graph — Implementation Notes',
};

export default function DocumentsPage() {
  return (
    <div className="docs">
      <nav className="docs-nav">
        <Link href="/">← Back to viewer</Link>
      </nav>

      <article>
        <h1>Knowledge Graph: Notes from a First Implementation</h1>

        <p className="lede">
          This page collects what was learned while ingesting the Learning Commons
          Knowledge Graph and building this viewer. It is not a replacement for the{' '}
          <a href="https://docs.learningcommons.org/knowledge-graph/" target="_blank" rel="noreferrer">
            official docs
          </a>{' '}
          — it is a practitioner&apos;s cheat sheet shaped by the real edges and
          rough corners of the dataset.
        </p>

        <h2>1. The shape of the files</h2>
        <p>Two newline-delimited JSON files distributed via CDN:</p>
        <ul>
          <li>
            <code>nodes.jsonl</code> — 242,543 records (242 MB uncompressed)
          </li>
          <li>
            <code>relationships.jsonl</code> — 389,742 records (402 MB uncompressed)
          </li>
        </ul>
        <p>A node record:</p>
        <pre>{`{
  "type": "node",
  "identifier": "<uuid>",
  "labels": ["StandardsFrameworkItem"],
  "properties": { "statementCode": "3.NF.A.1", "description": "..." }
}`}</pre>
        <p>A relationship record:</p>
        <pre>{`{
  "type": "relationship",
  "identifier": "<uuid>",
  "label": "hasChild",
  "properties": { "relationshipType": "hasChild", ... },
  "source_identifier": "<uuid>",
  "source_labels": ["StandardsFrameworkItem"],
  "target_identifier": "<uuid>",
  "target_labels": ["StandardsFrameworkItem"]
}`}</pre>

        <div className="callout">
          <strong>Trap:</strong> the <code>type</code> field on a relationship is
          always the literal string <code>&quot;relationship&quot;</code>. The
          actual edge class lives in <code>label</code>. A histogram on
          <code> type</code> will tell you there&apos;s only one kind of edge.
          There are ten.
        </div>

        <div className="callout">
          <strong>Trap:</strong> endpoints live at flat fields
          (<code>source_identifier</code>, <code>source_labels</code>,{' '}
          <code>target_identifier</code>, <code>target_labels</code>) — not
          nested <code>start</code>/<code>end</code> objects.
        </div>

        <h2>2. Node taxonomy (math slice)</h2>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Count</th>
              <th>What it is</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>StandardsFrameworkItem</code></td><td>46,319</td><td>a single academic standard</td></tr>
            <tr><td><code>Activity</code></td><td>8,173</td><td>a curriculum activity (warm-up, practice, cool-down)</td></tr>
            <tr><td><code>Assessment</code></td><td>4,516</td><td>practice problems / checks for understanding</td></tr>
            <tr><td><code>LearningComponent</code></td><td>4,069</td><td>an atomic decomposed skill</td></tr>
            <tr><td><code>Lesson</code></td><td>2,550</td><td>a curriculum lesson</td></tr>
            <tr><td><code>LessonGrouping</code></td><td>764</td><td>a unit or section</td></tr>
            <tr><td><code>StandardsFramework</code></td><td>52</td><td>one per jurisdiction (state)</td></tr>
            <tr><td><code>Course</code></td><td>18</td><td>a full course of study</td></tr>
          </tbody>
        </table>
        <p>
          <code>StandardsFrameworkItem</code> dominates (70% of math nodes). Any
          viewer that doesn&apos;t filter by framework first will drown in standards.
        </p>
        <p>
          <code>LearningComponent</code> is the quiet protagonist — it&apos;s the
          granular unit that bridges curriculum and standards (see §4).
        </p>

        <h2>3. Relationship taxonomy</h2>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Math count</th>
              <th>From → To</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>hasChild</code></td><td>46,319</td>
              <td>SFI → SFI (and SF → SFI)</td>
              <td>standards hierarchy (Domain → Cluster → Standard → Component)</td>
            </tr>
            <tr>
              <td><code>supports</code></td><td>74,658</td>
              <td>LearningComponent → SFI</td>
              <td>&quot;this atomic skill contributes to this standard&quot;</td>
            </tr>
            <tr>
              <td><code>hasEducationalAlignment</code></td><td>52,807</td>
              <td>Curriculum → SFI</td>
              <td>&quot;this content teaches/builds on this standard&quot; — includes <code>alignmentType</code> and <code>curriculumAlignmentType</code></td>
            </tr>
            <tr>
              <td><code>hasStandardAlignment</code></td><td>20,548</td>
              <td>SFI → SFI</td>
              <td>cross-state crosswalk; derived from shared LCs, carries <code>jaccard</code> score</td>
            </tr>
            <tr>
              <td><code>hasPart</code></td><td>17,373</td>
              <td>Course → Unit → Lesson → Activity/Assessment</td>
              <td>curriculum containment</td>
            </tr>
            <tr>
              <td><code>buildsTowards</code></td><td>757</td>
              <td>SFI → SFI</td>
              <td>learning progression (directional, weaker than &quot;prereq&quot;)</td>
            </tr>
            <tr>
              <td><code>hasReference</code></td><td>472</td>
              <td>Lesson ↔ Lesson/Activity/Assessment</td>
              <td>soft curriculum links (unlock, supplementary)</td>
            </tr>
            <tr>
              <td><code>relatesTo</code></td><td>284</td>
              <td>SFI → SFI</td>
              <td>conceptual overlap, no sequence implied</td>
            </tr>
            <tr>
              <td><code>hasDependency</code></td><td>209</td>
              <td>LessonGrouping → LessonGrouping</td>
              <td>hard prereq between units</td>
            </tr>
            <tr>
              <td><code>mutuallyExclusiveWith</code></td><td>96</td>
              <td>Assessment → Assessment</td>
              <td>assessment variants; pick one</td>
            </tr>
          </tbody>
        </table>
        <p>
          The interesting structural fact:{' '}
          <code>hasStandardAlignment</code> is <em>derived</em>, not authored. Its
          properties include <code>jaccard</code>, <code>ccssLCCount</code>,{' '}
          <code>sharedLCCount</code>, <code>stateLCCount</code>. The crosswalk
          between state standards is computed by measuring overlap of decomposed{' '}
          <code>LearningComponent</code>s — a Jaccard of 1.0 means two standards have
          identical LC support. That is how &quot;Texas standard X ≈ CCSS standard
          Y&quot; claims are made rigorously rather than asserted.
        </p>

        <h2>4. The mental model</h2>
        <p>Think of the graph in four layers:</p>
        <pre>{`Curriculum layer    Course -> LessonGrouping -> Lesson -> Activity/Assessment
                    (connected via hasPart)
                           |
                           | hasEducationalAlignment
                           v
Standards layer     StandardsFramework -> SFI tree (via hasChild)
                           ^
                           | supports
                           |
LearningComponent   atomic decomposed skills
layer                      |
                           | (Jaccard overlap)
                           v
Crosswalk           hasStandardAlignment between SFIs across jurisdictions`}</pre>
        <p>
          <strong>&quot;What teaches 3.NF.A.1?&quot;</strong> — start at the standard
          node, walk <code>supports</code> inbound for LCs, and{' '}
          <code>hasEducationalAlignment</code> inbound for curriculum that claims to
          teach it.
        </p>
        <p>
          <strong>&quot;What does California say is equivalent to this CCSS
          standard?&quot;</strong> — walk <code>hasStandardAlignment</code> from the
          CCSS SFI to California SFIs, sorted by <code>jaccard</code>.
        </p>
        <p>
          <strong>&quot;What&apos;s a prerequisite for this lesson?&quot;</strong> —
          walk <code>hasDependency</code> between LessonGroupings and{' '}
          <code>hasReference</code>/<code>hasPart</code> across lessons.
        </p>

        <h2>5. Property gotchas</h2>
        <p>
          Several properties are <strong>stringified JSON</strong>, not real arrays
          or objects. If you ignore this, filters silently do nothing.
        </p>
        <ul>
          <li><code>gradeLevel</code> → <code>&quot;[\&quot;3\&quot;]&quot;</code> or <code>&quot;[\&quot;middle_school\&quot;,\&quot;6\&quot;,\&quot;7\&quot;,\&quot;8\&quot;]&quot;</code></li>
          <li><code>audience</code> → <code>&quot;[\&quot;Teacher\&quot;,\&quot;Student\&quot;,\&quot;Family\&quot;]&quot;</code></li>
        </ul>
        <p>
          Always <code>JSON.parse</code> before comparing.
        </p>
        <p>Other shape notes:</p>
        <ul>
          <li>
            Relationship properties include <code>sourceEntityKey</code> /{' '}
            <code>targetEntityKey</code> — <code>&quot;identifier&quot;</code> for
            Illustrative Math curriculum, <code>&quot;caseIdentifierUUID&quot;</code>{' '}
            for 1EdTech standards. For graph traversal use the flat{' '}
            <code>source_identifier</code>/<code>target_identifier</code>; these key
            hints matter only when reconstructing back to the raw CASE source.
          </li>
          <li>
            <code>identifier</code> prefixes hint at source:{' '}
            <code>im:</code> = Illustrative Mathematics curriculum; bare UUIDs =
            1EdTech or generated.
          </li>
          <li>
            <code>provider</code> is always <code>&quot;Learning Commons&quot;</code>.
            The real origin is in <code>author</code> (1EdTech, Illustrative
            Mathematics, Achievement Network, Student Achievement Partners).
          </li>
          <li>
            Time durations use ISO-8601 duration syntax:{' '}
            <code>&quot;PT5M&quot;</code> (5 minutes), <code>&quot;P136D&quot;</code>{' '}
            (136 days).
          </li>
        </ul>

        <h2>6. Filtering to math</h2>
        <p>The full dataset covers multiple subjects. For a math-only app:</p>
        <pre>{`nodes:         properties.academicSubject === "Mathematics"
relationships: both endpoints are in the math node set`}</pre>
        <p>
          This reduces the dataset from 242k/390k to 66k/214k — 27% of nodes, 55% of
          edges. Relationships survive at a higher rate because the math subgraph is
          densely intra-connected.
        </p>

        <h2>7. Visualization notes</h2>
        <ul>
          <li>
            The full math graph (66k nodes) is too large for a single vis-network
            canvas without the browser stalling.{' '}
            <strong>Always filter to a single framework first</strong> — that&apos;s
            ~1,500 nodes for California Common Core, which renders smoothly.
          </li>
          <li>
            <code>hasChild</code> alone forms a tree (StandardsFramework at root,
            SFIs below). A hierarchical layout is a better default than
            force-directed once you know this.
          </li>
          <li>
            Disable physics after initial stabilization (
            <code>stabilizationIterationsDone</code> event in vis-network) so nodes
            don&apos;t drift after the layout settles.
          </li>
          <li>
            vis-network caveat: the container element must have an <em>explicit</em>{' '}
            height. A <code>&lt;div&gt;</code> whose only child is absolutely
            positioned will collapse to zero and the graph will appear &quot;not to
            render&quot; even though the data is present.
          </li>
        </ul>

        <h2>8. Stream, don&apos;t load</h2>
        <p>Both files are large enough to matter:</p>
        <ul>
          <li><code>nodes.jsonl</code> — 242 MB uncompressed</li>
          <li><code>relationships.jsonl</code> — 402 MB uncompressed</li>
        </ul>
        <p>
          <code>JSON.parse</code> on the whole buffer works in Node with enough RAM,
          but is unnecessary. Line-by-line streaming via{' '}
          <code>readline.createInterface</code> handles either file in 1–3 seconds on
          a modern laptop and avoids a 600+ MB heap.
        </p>
        <p>
          For repeated queries, load once into in-memory maps and cache — the
          Next.js API route here does this. Cold request is ~3s; warm requests run
          under 100ms.
        </p>

        <h2>9. What&apos;s still open</h2>
        <ul>
          <li>
            <code>LearningComponent</code> descriptions suggest decomposition was
            hand-curated by Achievement Network. No property tells you which
            standard framework a given LC is tied to — you discover that only by
            walking <code>supports</code> edges.
          </li>
          <li>
            <code>buildsTowards</code> and <code>relatesTo</code> are sparse (~1000
            edges combined). They are the most pedagogically valuable edges for
            building learning progressions, but by count they are dwarfed by{' '}
            <code>hasChild</code>.
          </li>
          <li>
            <code>StandardsFramework</code> has an <code>adoptionStatus</code> field
            (<code>&quot;Implemented&quot;</code>, etc.) that could let you
            differentiate current from legacy frameworks. Unused here.
          </li>
          <li>
            <code>hasStandardAlignment</code> <code>jaccard</code> is a string, not a
            number — parse it if you plan to sort or threshold.
          </li>
        </ul>
      </article>
    </div>
  );
}
