'use client';

import type { CoherenceIxlLevel, CoherenceIxlSkill } from '@/lib/coherenceIxl';
import { buildIxlQuestionUrl } from '@/lib/coherenceIxl';
import {
  diagnosticOutcomeOptions,
  type DiagnosticCandidateView,
  type DiagnosticOutcome,
} from '@/lib/diagnosticEngine';

type Props = {
  candidate: DiagnosticCandidateView | null;
  skill: CoherenceIxlSkill | null;
  selectedLevel: CoherenceIxlLevel | null;
  onOutcome: (outcome: DiagnosticOutcome) => void;
};

export default function DiagnosticQuestionSurface({
  candidate,
  skill,
  selectedLevel,
  onOutcome,
}: Props) {
  if (!candidate) {
    return (
      <div className="diag-tab-panel">
        <div className="diag-panel-head">
          <div>
            <h3>Question Surface</h3>
          </div>
        </div>
        <div className="diag-empty">
          Start a session to load the first diagnostic skill and its scraped question files.
        </div>
      </div>
    );
  }

  if (!skill || !skill.levels.length) {
    return (
      <div className="diag-tab-panel">
        <div className="diag-panel-head">
          <div>
            <h3>Question Surface</h3>
          </div>
        </div>
        <div className="diag-empty">
          No scraped question files are available for{' '}
          <strong>{candidate.skill_code || candidate.skill_id}</strong> on{' '}
          <strong>{candidate.source_standard_code}</strong>.
        </div>
      </div>
    );
  }

  const activeLevel = selectedLevel ?? skill.levels[0];
  const questionUrl = buildIxlQuestionUrl(activeLevel);

  return (
    <div className="diag-question-pane">
      <div className="diag-question-scroll">
        <iframe
          key={activeLevel.source_file}
          className="diag-question-frame"
          src={questionUrl}
          title={`Question surface for ${candidate.skill_code || candidate.skill_id}`}
        />
      </div>

      <div className="diag-question-actions">
        {diagnosticOutcomeOptions().map((option) => (
          <button
            key={option.id}
            type="button"
            className={`diag-action ${option.id}`}
            onClick={() => onOutcome(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
