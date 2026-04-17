import { NextResponse } from 'next/server';
import { loadGraph } from '@/lib/graph';

export const dynamic = 'force-dynamic';

export async function GET() {
  const g = await loadGraph();
  const frameworks = g.frameworks.map((f) => ({
    identifier: f.identifier,
    jurisdiction: f.properties.jurisdiction as string | undefined,
    name: (f.properties.name as string | undefined) ?? null,
  }));
  return NextResponse.json({
    frameworks,
    count: frameworks.length,
  });
}
