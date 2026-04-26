/**
 * Replay the user-reported grade-1 session (13 corrects) and print the full
 * recommendation chain with skill names and num_levels per step.
 *
 * Goal: confirm that, with the new complexity-ramp scoring, when domain
 * mastery climbs the engine picks higher-num_levels skills and standards with
 * larger ancestor counts (more advanced standards) within the same domain
 * rather than backsliding to foundational ones.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createDiagnosticModel,
  simulateDiagnosticSession,
  type DiagnosticOutcome,
} from '@/lib/diagnosticEngine';

const GRADE = '1';
const STEPS = 13;

function main() {
  const root = path.resolve(__dirname, '..');
  const graph = JSON.parse(
    fs.readFileSync(path.join(root, 'public/coherence/graph.json'), 'utf8'),
  );
  const adaptive = JSON.parse(
    fs.readFileSync(path.join(root, 'public/coherence/adaptive-diagnostic.json'), 'utf8'),
  );
  const model = createDiagnosticModel(graph, adaptive);

  const outcomes: DiagnosticOutcome[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    const session = simulateDiagnosticSession(model, GRADE, outcomes, {
      includeBranchPreview: false,
    });
    const c = session.current_recommendation;
    if (!c) break;
    const plan = adaptive.by_standard_code?.[c.target_standard_code];
    const ancestorCount = plan?.ancestor_standard_count ?? 0;
    const dom = session.domain_mastery.find((s) => s.domain === c.target_standard_domain);
    const domMastery = dom ? dom.mastery_raw : 0.5;
    console.log(
      `step ${String(step + 1).padStart(2)}  ` +
        `domain=${(c.target_standard_domain ?? '?').padEnd(3)}  ` +
        `std=${c.target_standard_code.padEnd(14)}  ` +
        `skill=${(c.skill_code ?? c.skill_id).padEnd(10)}  ` +
        `levels=${c.num_levels}  ` +
        `qcount=${c.question_count}  ` +
        `ancestors=${String(ancestorCount).padStart(2)}  ` +
        `domMastery=${domMastery.toFixed(3)}  ` +
        `name="${c.skill_name ?? ''}"`,
    );
    outcomes.push('correct');
  }
  console.log('\nFinal domain mastery:');
  const final = simulateDiagnosticSession(model, GRADE, outcomes, {
    includeBranchPreview: false,
  });
  for (const s of final.domain_mastery) {
    if (s.domain === 'MP') continue;
    console.log(
      `  ${s.domain}: shrunken=${s.mastery.toFixed(3)} raw=${s.mastery_raw.toFixed(3)} confidence=${s.confidence.toFixed(2)} band=${s.band}`,
    );
  }
}

main();
