'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CoherenceGraph } from '@/lib/coherence';
import type { AdaptiveDiagnosticIndex } from '@/lib/coherenceAdaptive';
import type { CoherenceIxlIndex } from '@/lib/coherenceIxl';
import DiagnosticSimulator from '@/components/DiagnosticSimulator';

export default function DiagnosticPage() {
  const [graph, setGraph] = useState<CoherenceGraph | null>(null);
  const [adaptive, setAdaptive] = useState<AdaptiveDiagnosticIndex | null>(null);
  const [ixl, setIxl] = useState<CoherenceIxlIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialGrade, setInitialGrade] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/coherence/graph.json').then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`graph ${r.status}`)),
      ),
      fetch('/coherence/adaptive-diagnostic.json').then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`adaptive ${r.status}`)),
      ),
      fetch('/coherence/ixl-links.json').then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`ixl ${r.status}`)),
      ),
    ])
      .then(([graphData, adaptiveData, ixlData]) => {
        setGraph(graphData as CoherenceGraph);
        setAdaptive(adaptiveData as AdaptiveDiagnosticIndex);
        setIxl(ixlData as CoherenceIxlIndex);
      })
      .catch((e) => setError(String(e)));

    const params = new URLSearchParams(window.location.search);
    const grade = params.get('grade');
    if (grade) setInitialGrade(grade);
  }, []);

  if (error) {
    return (
      <div className="coh-app">
        <div className="toolbar">
          <span className="title">Graph-Adaptive Diagnostic Simulator · CCSS-M</span>
          <div className="stats" style={{ color: '#c0392b' }}>
            {error}
          </div>
          <Link href="/coherence" style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}>
            Coherence Map →
          </Link>
          <Link href="/" style={{ marginLeft: 14, color: '#4a90e2', textDecoration: 'none' }}>
            ← KG Viewer
          </Link>
        </div>
      </div>
    );
  }

  if (!graph || !adaptive || !ixl) {
    return (
      <div className="coh-app">
        <div className="toolbar">
          <span className="title">Graph-Adaptive Diagnostic Simulator · CCSS-M</span>
          <div className="stats">Loading graph, adaptive plans, and IXL question links…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="coh-app">
      <DiagnosticSimulator
        graph={graph}
        adaptive={adaptive}
        ixl={ixl}
        initialGrade={initialGrade}
      />
    </div>
  );
}
