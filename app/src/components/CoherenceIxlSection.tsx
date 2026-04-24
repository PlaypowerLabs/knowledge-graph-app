'use client';

import {
  type CoherenceIxlStandard,
  formatIxlLevelMeta,
} from '@/lib/coherenceIxl';

type Props = {
  standardCode: string;
  data: CoherenceIxlStandard | null;
  loading?: boolean;
  error?: string | null;
};

export default function CoherenceIxlSection({ standardCode, data, loading, error }: Props) {
  return (
    <section className="coh-ixl">
      <div className="coh-ixl-head">
        <h4>IXL Skills</h4>
        <span className="coh-ixl-count">
          {data ? `${data.skill_count} skill${data.skill_count === 1 ? '' : 's'}` : '0 skills'}
        </span>
      </div>

      {loading && <div className="coh-ixl-empty">Loading IXL links…</div>}
      {error && !loading && <div className="coh-ixl-empty">{error}</div>}
      {!loading && !error && !data && (
        <div className="coh-ixl-empty">No mapped IXL skills for {standardCode}.</div>
      )}

      {!loading && !error && data && data.skills.length === 0 && (
        <div className="coh-ixl-empty">No mapped IXL skills for {standardCode}.</div>
      )}

      {!loading && !error && data?.skills.length ? (
        <div className="coh-ixl-skills">
          {data.skills.map((skill) => {
            const externalUrl = skill.ixl_skill_url
              ? skill.ixl_skill_url.startsWith('http')
                ? skill.ixl_skill_url
                : `https://www.ixl.com${skill.ixl_skill_url}`
              : null;

            return (
              <details key={skill.skill_id} className="coh-ixl-skill">
                <summary className="coh-ixl-summary">
                  <div className="coh-ixl-summary-main">
                    <span className="coh-ixl-skill-code">{skill.skill_code || 'Uncoded skill'}</span>
                    <span className="coh-ixl-skill-name">{skill.skill_name || skill.skill_id}</span>
                  </div>
                  <span className="coh-ixl-summary-meta">
                    {skill.question_file_count} file{skill.question_file_count === 1 ? '' : 's'}
                  </span>
                </summary>

                <div className="coh-ixl-body">
                  <div className="coh-ixl-skill-meta">
                    {skill.permacode && <span>Permacode {skill.permacode}</span>}
                    <span>
                      {skill.question_count} question{skill.question_count === 1 ? '' : 's'}
                    </span>
                    <span>
                      {skill.num_levels} available level
                      {skill.num_levels === 1 ? '' : 's'}
                    </span>
                    {externalUrl && (
                      <a href={externalUrl} target="_blank" rel="noreferrer">
                        Open on IXL
                      </a>
                    )}
                  </div>

                  {skill.levels.length ? (
                    <ul className="coh-ixl-levels">
                      {skill.levels.map((level) => (
                        <li key={`${skill.skill_id}:${level.source_file}`} className="coh-ixl-level">
                          <a href={level.viewer_url} target="_blank" rel="noreferrer">
                            {level.label}
                          </a>
                          <div className="coh-ixl-level-meta">
                            {formatIxlLevelMeta(level)}
                            <code>{level.source_file}</code>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="coh-ixl-empty">No scraped files available for this skill.</div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
