/**
 * Diagnostic engine evaluation harness.
 *
 * For each persona × seed × item-budget:
 *   1. Build a stochastic answerer from the persona's ground-truth domain abilities.
 *   2. Run the engine for the given item budget, sampling outcomes from the answerer.
 *   3. Aggregate engine output into per-domain mastery + classification band.
 *   4. Compare against the persona's ground-truth band and mastery.
 *
 * Reports:
 *   - Per-domain classification accuracy (Below / On / Above grade-level expectation)
 *   - Per-domain mastery RMSE vs. ground truth
 *   - Failure-mode breakdown by persona × domain
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createDiagnosticModel,
  simulateDiagnosticSession,
  type DiagnosticCandidateView,
  type DiagnosticModel,
  type DiagnosticOutcome,
  type DiagnosticSessionView,
} from '@/lib/diagnosticEngine';

const GRADE = '3';
const CONTENT_DOMAINS = ['OA', 'NBT', 'NF', 'MD', 'G'] as const;
type Domain = (typeof CONTENT_DOMAINS)[number];

const ITEM_BUDGETS = process.env.SIM_BUDGETS
  ? process.env.SIM_BUDGETS.split(',').map((s) => parseInt(s.trim(), 10))
  : [20, 30, 40, 50];
const SEEDS_PER_PERSONA = process.env.SIM_SEEDS
  ? parseInt(process.env.SIM_SEEDS, 10)
  : 6;

// ---- Random number generator (mulberry32, deterministic) ----
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Persona ground-truth model ----
type Persona = {
  id: string;
  description: string;
  // True mastery per content domain at grade 3 (probability of getting a grade-3 item right)
  trueAbility: Record<Domain, number>;
};

const personas: Persona[] = [
  {
    id: 'high-achiever',
    description: 'Mastery student across all domains.',
    trueAbility: { OA: 0.92, NBT: 0.9, NF: 0.88, MD: 0.9, G: 0.92 },
  },
  {
    id: 'on-grade-balanced',
    description: 'Roughly on grade level across the board.',
    trueAbility: { OA: 0.62, NBT: 0.6, NF: 0.55, MD: 0.6, G: 0.65 },
  },
  {
    id: 'below-grade-uniform',
    description: 'Behind across all domains.',
    trueAbility: { OA: 0.32, NBT: 0.3, NF: 0.28, MD: 0.32, G: 0.3 },
  },
  {
    id: 'fraction-freezer',
    description: 'On grade except fractions are a hard wall.',
    trueAbility: { OA: 0.75, NBT: 0.7, NF: 0.18, MD: 0.7, G: 0.7 },
  },
  {
    id: 'place-value-hole',
    description: 'NBT gap drags NF and MD slightly; OA fluent.',
    trueAbility: { OA: 0.78, NBT: 0.22, NF: 0.45, MD: 0.5, G: 0.7 },
  },
  {
    id: 'measurement-weak',
    description: 'Strong number sense, weak measurement.',
    trueAbility: { OA: 0.78, NBT: 0.75, NF: 0.7, MD: 0.28, G: 0.6 },
  },
  {
    id: 'geometry-only-strong',
    description: 'Behind on number; only G is on grade.',
    trueAbility: { OA: 0.35, NBT: 0.32, NF: 0.3, MD: 0.4, G: 0.78 },
  },
  {
    id: 'oa-only-weak',
    description: 'Strong elsewhere; OA fluency gap.',
    trueAbility: { OA: 0.28, NBT: 0.7, NF: 0.7, MD: 0.7, G: 0.78 },
  },
  {
    id: 'two-domain-weak',
    description: 'Weak NF + MD, otherwise on grade.',
    trueAbility: { OA: 0.7, NBT: 0.7, NF: 0.25, MD: 0.28, G: 0.7 },
  },
  {
    id: 'borderline-on-below',
    description: 'Right at the band boundary on every domain.',
    trueAbility: { OA: 0.42, NBT: 0.4, NF: 0.38, MD: 0.42, G: 0.45 },
  },
  {
    id: 'borderline-on-above',
    description: 'Right at the upper band boundary.',
    trueAbility: { OA: 0.7, NBT: 0.72, NF: 0.68, MD: 0.7, G: 0.72 },
  },
  {
    id: 'mld-very-low',
    description: 'Math learning difficulty, very low mastery.',
    trueAbility: { OA: 0.15, NBT: 0.1, NF: 0.08, MD: 0.12, G: 0.18 },
  },
  {
    id: 'one-strong-domain',
    description: 'Just one domain (OA) above grade, others below.',
    trueAbility: { OA: 0.85, NBT: 0.32, NF: 0.3, MD: 0.35, G: 0.32 },
  },
  {
    id: 'spotty-mid',
    description: 'Inconsistent — some on, some below.',
    trueAbility: { OA: 0.55, NBT: 0.42, NF: 0.65, MD: 0.32, G: 0.6 },
  },
];

// ---- Band definitions ----
type Band = 'below' | 'on' | 'above';
const ON_LOW = 0.4;
const ON_HIGH = 0.7;

function bandFor(mastery: number): Band {
  if (mastery < ON_LOW) return 'below';
  if (mastery > ON_HIGH) return 'above';
  return 'on';
}

// ---- Stochastic answerer ----
// Probability that an item is answered "noisily" (partial/unsure regardless of theta)
const NOISE_RATE = 0.08;

function sampleOutcome(
  persona: Persona,
  candidate: DiagnosticCandidateView,
  random: () => number,
): DiagnosticOutcome {
  const sourceGrade = candidate.source_standard_grade;
  const sourceDomain = (candidate.source_standard_domain || '') as Domain;
  const baseTheta =
    sourceDomain && (CONTENT_DOMAINS as readonly string[]).includes(sourceDomain)
      ? persona.trueAbility[sourceDomain]
      : 0.5;

  // Prerequisites are easier; above-grade items harder.
  let theta = baseTheta;
  const grade = parseInt(sourceGrade || '3', 10);
  if (Number.isFinite(grade) && grade < 3) {
    const gradeGap = 3 - grade;
    theta = Math.min(0.97, baseTheta + 0.18 * gradeGap);
  } else if (Number.isFinite(grade) && grade > 3) {
    const gradeGap = grade - 3;
    theta = Math.max(0.03, baseTheta - 0.22 * gradeGap);
  }

  // 92% of the time: pure binary Bernoulli(theta)  — correct/incorrect only.
  // 8% of the time: a "noisy" outcome (partial/unsure) regardless of theta.
  // This matches IRT/Rasch sampling assumptions used in MAP/iReady benchmarks
  // while still exercising the engine's 4-bin codepath.
  const r = random();
  if (r < NOISE_RATE) {
    const r2 = random();
    if (r2 < theta) return 'partial';
    return 'unsure';
  }
  const r2 = random();
  if (r2 < theta) return 'correct';
  return 'incorrect';
}

// ---- Aggregating engine output to domain mastery ----

type DomainAggregate = {
  domain: Domain;
  mastery: number;
  confidence: number;
  evidenceCount: number;
  standardCount: number;
};

/**
 * Read the engine's domain-level posterior directly from the session view.
 */
function aggregateDomainMastery(
  _model: DiagnosticModel,
  session: DiagnosticSessionView,
): Record<Domain, DomainAggregate> {
  const out: Record<string, DomainAggregate> = {};
  for (const snap of session.domain_mastery) {
    if (!CONTENT_DOMAINS.includes(snap.domain as Domain)) continue;
    out[snap.domain] = {
      domain: snap.domain as Domain,
      mastery: snap.mastery,
      confidence: snap.confidence,
      evidenceCount: snap.evidence_count,
      standardCount: snap.standard_count,
    };
  }
  for (const d of CONTENT_DOMAINS) {
    if (!out[d]) {
      out[d] = { domain: d, mastery: 0.5, confidence: 0, evidenceCount: 0, standardCount: 0 };
    }
  }
  return out as Record<Domain, DomainAggregate>;
}

// ---- Single simulation run ----
type RunResult = {
  persona: string;
  seed: number;
  budget: number;
  outcomes: DiagnosticOutcome[];
  domain: Record<Domain, DomainAggregate>;
  trueAbility: Record<Domain, number>;
  steps: number;
  itemsPerDomain: Record<Domain, number>;
};

function runSession(
  model: DiagnosticModel,
  persona: Persona,
  seed: number,
  budget: number,
): RunResult {
  const random = rng(seed);
  const events: DiagnosticOutcome[] = [];
  let session = simulateDiagnosticSession(model, GRADE, events, {
    includeBranchPreview: false,
  });
  const itemsPerDomain: Record<string, number> = {};
  let stoppedEarly = false;
  for (let step = 0; step < budget; step += 1) {
    const candidate = session.current_recommendation;
    if (!candidate) {
      stoppedEarly = true;
      break;
    }
    const sourceDomain = candidate.source_standard_domain || 'Unknown';
    itemsPerDomain[sourceDomain] = (itemsPerDomain[sourceDomain] || 0) + 1;
    const outcome = sampleOutcome(persona, candidate, random);
    events.push(outcome);
    session = simulateDiagnosticSession(model, GRADE, events, {
      includeBranchPreview: false,
    });
  }
  const domain = aggregateDomainMastery(model, session);
  const result: RunResult = {
    persona: persona.id,
    seed,
    budget,
    outcomes: events,
    domain,
    trueAbility: persona.trueAbility,
    steps: events.length,
    itemsPerDomain: Object.fromEntries(
      CONTENT_DOMAINS.map((d) => [d, itemsPerDomain[d] || 0]),
    ) as Record<Domain, number>,
  };
  if (stoppedEarly && events.length < budget) {
    // Just note in result; not an error
  }
  return result;
}

// ---- Aggregation across runs ----

type DomainStats = {
  trueMean: number;
  estMean: number;
  estStd: number;
  rmse: number;
  bandAccuracy: number;
  // Fraction of seeds where |est - true| < 0.10 — a softer, more useful metric
  // than strict band classification when the persona is near a band boundary.
  withinTenAcc: number;
  // Fuzzy band accuracy: accept band miss if est is within 0.05 of the boundary.
  fuzzyBandAccuracy: number;
  trueBand: Band;
  estBands: Record<Band, number>;
  itemsMean: number;
};

type PersonaReport = {
  persona: string;
  description: string;
  budget: number;
  domains: Record<Domain, DomainStats>;
  overallAccuracy: number;
  overallFuzzyAccuracy: number;
  overallWithinTen: number;
  overallRmse: number;
};

function summarizePersona(
  persona: Persona,
  budget: number,
  results: RunResult[],
): PersonaReport {
  const domains: Record<string, DomainStats> = {};
  for (const d of CONTENT_DOMAINS) {
    const trueTheta = persona.trueAbility[d];
    const ests = results.map((r) => r.domain[d].mastery);
    const items = results.map((r) => r.itemsPerDomain[d]);
    const estMean = ests.reduce((s, v) => s + v, 0) / ests.length;
    const estVar =
      ests.reduce((s, v) => s + (v - estMean) * (v - estMean), 0) / ests.length;
    const estStd = Math.sqrt(estVar);
    const rmse = Math.sqrt(
      ests.reduce((s, v) => s + (v - trueTheta) * (v - trueTheta), 0) / ests.length,
    );
    const trueBand = bandFor(trueTheta);
    const estBands: Record<Band, number> = { below: 0, on: 0, above: 0 };
    for (const v of ests) estBands[bandFor(v)] += 1;
    const bandAccuracy = estBands[trueBand] / ests.length;
    const withinTenAcc =
      ests.filter((v) => Math.abs(v - trueTheta) < 0.1).length / ests.length;
    const fuzzyBandAccuracy =
      ests.filter((v) => {
        const eb = bandFor(v);
        if (eb === trueBand) return true;
        // Within 0.05 of a band boundary counts as "soft pass".
        if (
          (trueBand === 'on' && eb === 'below' && v >= ON_LOW - 0.05) ||
          (trueBand === 'on' && eb === 'above' && v <= ON_HIGH + 0.05) ||
          (trueBand === 'below' && eb === 'on' && v <= ON_LOW + 0.05) ||
          (trueBand === 'above' && eb === 'on' && v >= ON_HIGH - 0.05)
        ) {
          return true;
        }
        return false;
      }).length / ests.length;
    domains[d] = {
      trueMean: trueTheta,
      estMean,
      estStd,
      rmse,
      bandAccuracy,
      withinTenAcc,
      fuzzyBandAccuracy,
      trueBand,
      estBands,
      itemsMean: items.reduce((s, v) => s + v, 0) / items.length,
    };
  }
  const ds = Object.values(domains);
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  return {
    persona: persona.id,
    description: persona.description,
    budget,
    domains: domains as Record<Domain, DomainStats>,
    overallAccuracy: mean(ds.map((d) => d.bandAccuracy)),
    overallFuzzyAccuracy: mean(ds.map((d) => d.fuzzyBandAccuracy)),
    overallWithinTen: mean(ds.map((d) => d.withinTenAcc)),
    overallRmse: Math.sqrt(mean(ds.map((d) => d.rmse * d.rmse))),
  };
}

// ---- Main ----
function main() {
  const root = path.resolve(__dirname, '..');
  const graph = JSON.parse(
    fs.readFileSync(path.join(root, 'public/coherence/graph.json'), 'utf8'),
  );
  const adaptive = JSON.parse(
    fs.readFileSync(path.join(root, 'public/coherence/adaptive-diagnostic.json'), 'utf8'),
  );
  const model = createDiagnosticModel(graph, adaptive);

  const allReports: PersonaReport[] = [];
  const failuresByDomain: Record<string, number> = {};
  const failuresByPersonaDomain: Array<{
    persona: string;
    domain: string;
    budget: number;
    bandAcc: number;
    rmse: number;
    trueTheta: number;
    estMean: number;
  }> = [];

  for (const budget of ITEM_BUDGETS) {
    console.log(`\n=== Budget ${budget} items ===`);
    for (const persona of personas) {
      const runs: RunResult[] = [];
      for (let seed = 1; seed <= SEEDS_PER_PERSONA; seed += 1) {
        runs.push(runSession(model, persona, seed * 1000 + budget, budget));
      }
      const report = summarizePersona(persona, budget, runs);
      allReports.push(report);
      const line: string[] = [];
      for (const d of CONTENT_DOMAINS) {
        const ds = report.domains[d];
        const flag = ds.bandAccuracy < 0.75 ? '!' : ' ';
        line.push(
          `${d}=${ds.estMean.toFixed(2)}/${ds.trueMean.toFixed(2)}(${ds.bandAccuracy.toFixed(
            2,
          )}n=${ds.itemsMean.toFixed(1)})${flag}`,
        );
        if (ds.bandAccuracy < 0.75) {
          failuresByDomain[d] = (failuresByDomain[d] || 0) + 1;
          failuresByPersonaDomain.push({
            persona: persona.id,
            domain: d,
            budget,
            bandAcc: ds.bandAccuracy,
            rmse: ds.rmse,
            trueTheta: ds.trueMean,
            estMean: ds.estMean,
          });
        }
      }
      console.log(
        `${persona.id.padEnd(22)} acc=${report.overallAccuracy.toFixed(
          2,
        )} fuzzy=${report.overallFuzzyAccuracy.toFixed(2)} ±10=${report.overallWithinTen.toFixed(
          2,
        )} rmse=${report.overallRmse.toFixed(3)}  ${line.join(' ')}`,
      );
    }
  }

  // Summary by budget
  console.log('\n=== Aggregate by budget ===');
  for (const budget of ITEM_BUDGETS) {
    const reports = allReports.filter((r) => r.budget === budget);
    const mean = (key: keyof PersonaReport) =>
      reports.reduce((s, r) => s + (r[key] as number), 0) / reports.length;
    const acc = mean('overallAccuracy');
    const fuzzyAcc = mean('overallFuzzyAccuracy');
    const within10 = mean('overallWithinTen');
    const rmse = mean('overallRmse');
    const failures = reports.filter((r) => r.overallAccuracy < 0.75).length;
    console.log(
      `  budget=${budget}  acc=${acc.toFixed(3)}  fuzzy=${fuzzyAcc.toFixed(
        3,
      )}  ±10=${within10.toFixed(3)}  rmse=${rmse.toFixed(
        3,
      )}  under75=${failures}/${reports.length}`,
    );
  }

  // Failure breakdown
  console.log('\n=== Per-domain failure count (< 0.75 band accuracy) ===');
  for (const d of Object.keys(failuresByDomain).sort()) {
    console.log(`  ${d}: ${failuresByDomain[d]}`);
  }

  console.log('\n=== Failure cases (< 0.75 band accuracy) ===');
  failuresByPersonaDomain.sort((a, b) => a.bandAcc - b.bandAcc);
  for (const f of failuresByPersonaDomain.slice(0, 30)) {
    console.log(
      `  budget=${f.budget} ${f.persona.padEnd(22)} ${f.domain}: acc=${f.bandAcc.toFixed(
        2,
      )} rmse=${f.rmse.toFixed(3)} true=${f.trueTheta.toFixed(2)} est=${f.estMean.toFixed(2)}`,
    );
  }

  // Write JSON report for downstream analysis
  const outDir = path.resolve(root, '../tmp-personas');
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'sim-harness-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        seeds_per_persona: SEEDS_PER_PERSONA,
        budgets: ITEM_BUDGETS,
        personas: personas.map((p) => ({
          id: p.id,
          description: p.description,
          trueAbility: p.trueAbility,
        })),
        reports: allReports,
      },
      null,
      2,
    ),
  );
  console.log(`\nReport written to ${reportPath}`);
}

main();
