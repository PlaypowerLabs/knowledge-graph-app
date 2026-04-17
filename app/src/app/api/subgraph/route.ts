import { NextRequest, NextResponse } from 'next/server';
import { getSubgraph } from '@/lib/graph';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const frameworkIdentifier = searchParams.get('framework');
  if (!frameworkIdentifier) {
    return NextResponse.json({ error: 'framework query param required' }, { status: 400 });
  }
  const includeCurriculum = searchParams.get('curriculum') === 'true';

  const t0 = Date.now();
  const { nodes, edges } = await getSubgraph({ frameworkIdentifier, includeCurriculum });
  const durationMs = Date.now() - t0;

  return NextResponse.json({
    nodes: nodes.map((n) => ({
      id: n.identifier,
      labels: n.labels,
      properties: n.properties,
    })),
    edges: edges.map((e, i) => ({
      id: e.identifier ?? `e${i}`,
      label: e.label,
      source: e.source_identifier,
      target: e.target_identifier,
      properties: e.properties,
    })),
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      durationMs,
    },
  });
}
