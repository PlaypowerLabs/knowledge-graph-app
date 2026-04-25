import fs from 'node:fs';
import path from 'node:path';
import {
  createDiagnosticModel,
  simulateDiagnosticSession,
  type DiagnosticModel,
  type DiagnosticOutcome,
} from '@/lib/diagnosticEngine';

const OUTCOMES: DiagnosticOutcome[] = ['correct', 'partial', 'unsure', 'incorrect'];
const MAX_DEPTH = 2;
const COVERAGE_PROBE_COUNT = 8;

function sameRecommendation(
  left:
    | {
        target_standard_code: string;
        source_standard_code: string;
        skill_id: string;
      }
    | null
    | undefined,
  right:
    | {
        target_standard_code: string;
        source_standard_code: string;
        skill_id: string;
      }
    | null
    | undefined,
) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.target_standard_code === right.target_standard_code &&
    left.source_standard_code === right.source_standard_code &&
    left.skill_id === right.skill_id
  );
}

function gradeDomains(model: DiagnosticModel, grade: string) {
  const domains = new Set<string>();
  for (const code of model.standardsByGrade.get(grade) || []) {
    const node = model.nodesByCode.get(code);
    if (node?.domain) domains.add(node.domain);
  }
  return domains;
}

function assertCoveragePath(
  model: DiagnosticModel,
  grade: string,
  outcome: DiagnosticOutcome,
) {
  const outcomes = Array.from({ length: COVERAGE_PROBE_COUNT }, () => outcome);
  const session = simulateDiagnosticSession(model, grade, outcomes, { includeBranchPreview: false });
  const candidates = session.history.map((entry) => entry.candidate);
  const targetCodes = candidates.map((candidate) => candidate.target_standard_code);
  const targetDomains = new Set(
    candidates
      .map((candidate) => candidate.target_standard_domain)
      .filter((domain): domain is string => Boolean(domain)),
  );
  const availableDomains = gradeDomains(model, grade);
  const expectedDomainCount = Math.min(grade === 'HS' ? 3 : 4, availableDomains.size, candidates.length);

  if (targetDomains.size < expectedDomainCount) {
    throw new Error(
      [
        `Coverage invariant failed for grade ${grade} with all-${outcome} outcomes.`,
        `Expected at least ${expectedDomainCount} domains in first ${candidates.length} probes,`,
        `saw ${targetDomains.size}: ${[...targetDomains].join(', ') || '(none)'}.`,
        `Targets: ${targetCodes.join(' -> ') || '(none)'}.`,
      ].join(' '),
    );
  }

  let runCode: string | null = null;
  let runLength = 0;
  for (const code of targetCodes) {
    if (code === runCode) runLength += 1;
    else {
      runCode = code;
      runLength = 1;
    }

    if (runLength > 2) {
      throw new Error(
        [
          `Lock-in invariant failed for grade ${grade} with all-${outcome} outcomes.`,
          `${code} appeared ${runLength} times consecutively.`,
          `Targets: ${targetCodes.join(' -> ')}.`,
        ].join(' '),
      );
    }
  }
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

  let checkedStates = 0;
  let checkedBranches = 0;

  const visit = (grade: string, outcomes: DiagnosticOutcome[], depth: number) => {
    const session = simulateDiagnosticSession(model, grade, outcomes);
    checkedStates += 1;

    for (const branch of session.branch_preview) {
      checkedBranches += 1;
      const nextSession = simulateDiagnosticSession(model, grade, [...outcomes, branch.outcome]);
      if (!sameRecommendation(branch.next_recommendation, nextSession.current_recommendation)) {
        throw new Error(
          [
            `Branch preview mismatch for grade ${grade} at depth ${depth}.`,
            `Outcomes so far: ${outcomes.join(', ') || '(start)'}`,
            `Branch: ${branch.outcome}`,
            `Preview: ${
              branch.next_recommendation
                ? `${branch.next_recommendation.skill_id} / ${branch.next_recommendation.target_standard_code}`
                : 'null'
            }`,
            `Actual: ${
              nextSession.current_recommendation
                ? `${nextSession.current_recommendation.skill_id} / ${nextSession.current_recommendation.target_standard_code}`
                : 'null'
            }`,
          ].join(' '),
        );
      }
    }

    if (depth >= MAX_DEPTH) return;
    for (const outcome of OUTCOMES) {
      visit(grade, [...outcomes, outcome], depth + 1);
    }
  };

  for (const grade of model.grades) {
    visit(grade, [], 0);
    assertCoveragePath(model, grade, 'correct');
    assertCoveragePath(model, grade, 'partial');
    assertCoveragePath(model, grade, 'incorrect');
  }

  console.log(
    `Verified diagnostic engine across ${model.grades.length} grades, ${checkedStates} simulated states, ${checkedBranches} branch previews, and coverage lock-in checks.`,
  );
}

main();
