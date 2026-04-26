/**
 * Diagnostic trace for domain-mastery updates.
 *
 * For a fixed outcome stream, print per-step:
 *   - candidate (source/target/grade/domain/relation)
 *   - outcome
 *   - per-domain raw mastery + shrunken mastery before/after
 *   - flag any step where target's domain mastery did NOT increase on a CORRECT
 *     answer. That is the user-reported anomaly.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createDiagnosticModel,
  simulateDiagnosticSession,
  type DiagnosticOutcome,
  type DiagnosticDomainMasterySnapshot,
} from '@/lib/diagnosticEngine';

const GRADE = '3';
const STEPS = 30;

function fmtDom(snaps: DiagnosticDomainMasterySnapshot[]): string {
  return snaps
    .filter((s) => s.domain !== 'MP')
    .map((s) => `${s.domain}=${s.mastery.toFixed(3)}(c=${s.confidence.toFixed(2)},n=${s.direct_evidence_count}/${s.indirect_evidence_count})`)
    .join('  ');
}

function deltaMap(
  before: DiagnosticDomainMasterySnapshot[],
  after: DiagnosticDomainMasterySnapshot[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const beforeMap = new Map(before.map((s) => [s.domain, s.mastery]));
  for (const s of after) {
    out[s.domain] = s.mastery - (beforeMap.get(s.domain) ?? 0.5);
  }
  return out;
}

type Scenario = {
  name: string;
  // Decide outcome for a given step / candidate. Each scenario returns a fixed
  // outcome stream to feed the engine.
  outcome: (step: number, candidate: { source_standard_code: string; source_standard_domain: string | null; relation: string }) => DiagnosticOutcome;
};

const scenarios: Scenario[] = [
  {
    name: 'all-correct',
    outcome: () => 'correct',
  },
  {
    name: 'fraction-freezer (NF wrong, others correct)',
    outcome: (_, c) =>
      c.source_standard_domain === 'NF' ? 'incorrect' : 'correct',
  },
  {
    name: 'measurement-weak (MD wrong, others correct)',
    outcome: (_, c) =>
      c.source_standard_domain === 'MD' ? 'incorrect' : 'correct',
  },
  {
    name: 'mostly-wrong-then-correct (first 10 wrong, then 20 correct)',
    outcome: (step) => (step < 10 ? 'incorrect' : 'correct'),
  },
  {
    name: 'partial-on-NF (NF partial, others correct)',
    outcome: (_, c) =>
      c.source_standard_domain === 'NF' ? 'partial' : 'correct',
  },
  {
    name: 'oa-strong (OA correct, others wrong)',
    outcome: (_, c) =>
      c.source_standard_domain === 'OA' ? 'correct' : 'incorrect',
  },
  // Stress tests: targeted at finding "correct but mastery didn't increase".
  {
    name: 'one-domain-perfect (NF correct only when probed, rest wrong)',
    outcome: (_, c) =>
      c.source_standard_domain === 'NF' ? 'correct' : 'incorrect',
  },
  {
    name: 'alternating wrong-correct-correct',
    outcome: (step) => (step % 3 === 0 ? 'incorrect' : 'correct'),
  },
  {
    name: 'oscillating per-domain (every NF probe alternates)',
    outcome: (step, c) => {
      if (c.source_standard_domain !== 'NF') return 'correct';
      return step % 2 === 0 ? 'incorrect' : 'correct';
    },
  },
  {
    name: 'late-recovery (first 15 incorrect, then all correct)',
    outcome: (step) => (step < 15 ? 'incorrect' : 'correct'),
  },
];

function runScenario(model: ReturnType<typeof createDiagnosticModel>, scenario: Scenario, verbose: boolean) {
  const outcomes: DiagnosticOutcome[] = [];
  let anomalies = 0;
  const anomalyDetails: string[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    const before = simulateDiagnosticSession(model, GRADE, outcomes, {
      includeBranchPreview: false,
    });
    if (!before.current_recommendation) break;
    const c = before.current_recommendation;
    const outcome = scenario.outcome(step, {
      source_standard_code: c.source_standard_code,
      source_standard_domain: c.source_standard_domain,
      relation: c.relation,
    });
    outcomes.push(outcome);
    const after = simulateDiagnosticSession(model, GRADE, outcomes, {
      includeBranchPreview: false,
    });
    const delta = deltaMap(before.domain_mastery, after.domain_mastery);

    const targetDomain = c.target_standard_domain ?? '?';
    const targetGrade = c.target_standard_grade ?? '?';
    const dTarget = delta[targetDomain] ?? 0;
    // Flag any case where outcome is CORRECT and ANY domain's mastery dropped.
    // This is the user-reported case (broader than just target domain).
    if (outcome === 'correct') {
      const drops = Object.entries(delta).filter(
        ([dom, d]) => d < -0.0001 && dom !== 'MP',
      );
      if (drops.length > 0) {
        anomalies += 1;
        const beforeRow = before.domain_mastery
          .filter((s) => s.domain !== 'MP')
          .map((s) => `${s.domain}=${s.mastery.toFixed(4)}(raw=${s.mastery_raw.toFixed(4)},c=${s.confidence.toFixed(2)})`)
          .join(' ');
        const afterRow = after.domain_mastery
          .filter((s) => s.domain !== 'MP')
          .map((s) => `${s.domain}=${s.mastery.toFixed(4)}(raw=${s.mastery_raw.toFixed(4)},c=${s.confidence.toFixed(2)})`)
          .join(' ');
        const dropList = drops
          .map(([dom, d]) => `${dom}=${d.toFixed(4)}`)
          .join(' ');
        anomalyDetails.push(
          `step ${step + 1}: correct on [${c.relation}] target=${targetDomain} ${c.target_standard_code}  DROPS: ${dropList}\n        before: ${beforeRow}\n        after:  ${afterRow}`,
        );
      }
    }
    if (verbose) {
      const flagStr = flag ? '  ⚠ NO INCREASE' : '';
      console.log(
        `step ${String(step + 1).padStart(2)}: [${outcome.padEnd(9)}] [${c.relation.padEnd(10)}] g${targetGrade} ${targetDomain.padEnd(3)}  ${c.source_standard_code.padEnd(14)} → ${c.target_standard_code.padEnd(14)}  Δ${targetDomain}=${dTarget >= 0 ? '+' : ''}${dTarget.toFixed(3)}${flagStr}`,
      );
    }
  }
  return { anomalies, anomalyDetails, totalSteps: outcomes.length };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const graph = JSON.parse(
    fs.readFileSync(path.join(root, 'public/coherence/graph.json'), 'utf8'),
  );
  const adaptive = JSON.parse(
    fs.readFileSync(path.join(root, 'public/coherence/adaptive-diagnostic.json'), 'utf8'),
  );
  const model = createDiagnosticModel(graph, adaptive);

  for (const s of scenarios) {
    console.log(`\n=== ${s.name} ===`);
    const r = runScenario(model, s, false);
    console.log(`anomalies: ${r.anomalies} / ${r.totalSteps} positive-outcome steps where target-domain mastery did NOT increase`);
    for (const d of r.anomalyDetails.slice(0, 10)) {
      console.log('  ' + d);
    }
  }
}

main();
