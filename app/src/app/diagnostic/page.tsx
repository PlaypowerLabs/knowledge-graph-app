'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CoherenceGraph } from '@/lib/coherence';
import type { AdaptiveDiagnosticIndex } from '@/lib/coherenceAdaptive';
import DiagnosticSimulator from '@/components/DiagnosticSimulator';

export default function DiagnosticPage() {
  const [graph, setGraph] = useState<CoherenceGraph | null>(null);
  const [adaptive, setAdaptive] = useState<AdaptiveDiagnosticIndex | null>(null);
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
    ])
      .then(([graphData, adaptiveData]) => {
        setGraph(graphData as CoherenceGraph);
        setAdaptive(adaptiveData as AdaptiveDiagnosticIndex);
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

  if (!graph || !adaptive) {
    return (
      <div className="coh-app">
        <div className="toolbar">
          <span className="title">Graph-Adaptive Diagnostic Simulator · CCSS-M</span>
          <div className="stats">Loading graph and adaptive plans…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="coh-app">
      <DiagnosticSimulator graph={graph} adaptive={adaptive} initialGrade={initialGrade} />
    </div>
  );
}
