'use client';

import type { GraphNode } from './GraphViewer';
import { htmlToPlainText, formatGradeLevel, parseListField } from '@/lib/text';

const SKIP = new Set([
  'identifier',
  'attributionStatement',
  'license',
  'provider',
  'inLanguage',
  'description', // rendered separately
  'name',        // in header
  'statementCode', // in header
]);

const LIST_FIELDS = new Set(['gradeLevel', 'audience']);

function formatValue(key: string, raw: unknown): string {
  if (raw == null) return '';
  const s = String(raw);
  if (key === 'gradeLevel') return formatGradeLevel(s);
  if (LIST_FIELDS.has(key)) return parseListField(s).join(', ');
  return htmlToPlainText(s);
}

export default function NodeDetail({
  node,
  onClose,
}: {
  node: GraphNode | null;
  onClose: () => void;
}) {
  if (!node) return null;
  const p = node.properties as Record<string, unknown>;
  const description = htmlToPlainText(p.description as string | undefined);
  const entries = Object.entries(p).filter(
    ([k, v]) => !SKIP.has(k) && v != null && v !== '',
  );

  return (
    <div className="detail">
      <span className="close" onClick={onClose}>×</span>
      <h4>
        {node.labels.join(', ')}
        {p.statementCode ? ` · ${String(p.statementCode)}` : ''}
      </h4>
      <div className="meta">
        <code>{node.id}</code>
      </div>
      {p.name ? <div style={{ fontWeight: 500, marginBottom: 4 }}>{htmlToPlainText(String(p.name))}</div> : null}
      {description && (
        <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 10px' }}>{description}</p>
      )}
      <table>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: '#666', paddingRight: 10, verticalAlign: 'top', fontSize: 11 }}>{k}</td>
              <td style={{ fontSize: 11.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                {formatValue(k, v).slice(0, 400)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
