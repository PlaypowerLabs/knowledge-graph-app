'use client';

import { useMemo, useState } from 'react';
import { ChevronsDown, ChevronsUp } from 'lucide-react';
import type { CoherenceLearningComponent } from '@/lib/coherence';

type Props = {
  items: CoherenceLearningComponent[];
};

const DEFAULT_VISIBLE = 6;

export default function CoherenceLearningComponentsSection({ items }: Props) {
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => (a.description || '').localeCompare(b.description || '')),
    [items],
  );

  const visible = showAll ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = Math.max(sorted.length - visible.length, 0);

  return (
    <section className="coh-lc">
      <div className="coh-lc-head">
        <h4>Learning Components</h4>
        <span className="coh-lc-count">
          {sorted.length} component{sorted.length === 1 ? '' : 's'}
        </span>
      </div>

      {sorted.length ? (
        <>
          <div className="coh-lc-list">
            {visible.map((item) => (
              <div key={item.id} className="coh-lc-item">
                <div className="coh-lc-text">{item.description || item.id}</div>
                {(item.author || item.provider) && (
                  <div className="coh-lc-meta">
                    {[item.author, item.provider].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              className="coh-lc-toggle"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
              {showAll ? 'Show fewer' : `Show ${hiddenCount} more`}
            </button>
          )}
        </>
      ) : (
        <div className="coh-lc-empty">No direct learning components recorded for this standard.</div>
      )}
    </section>
  );
}
