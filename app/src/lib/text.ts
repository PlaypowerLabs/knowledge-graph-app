// Text helpers for the CASE-sourced data, which embeds raw HTML fragments
// (<div>, <br>, named entities) inside plain description fields.

const NAMED_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp|mdash|ndash|hellip);/g, (m) => NAMED_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Turn HTML-ish rich text into plain multiline text.
// <br> and block-close tags become newlines; other tags are stripped; entities decoded.
export function htmlToPlainText(s: string | null | undefined): string {
  if (!s) return '';
  const withBreaks = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withBreaks).replace(/\n{3,}/g, '\n\n').trim();
}

// Parse the stringified-JSON array fields (gradeLevel, audience, ...) back to a nice label.
export function parseListField(raw: string | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as unknown as string[];
  const s = String(raw).trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* fall through */
  }
  return [s];
}

export function formatGradeLevel(raw: string | null | undefined): string {
  const items = parseListField(raw);
  const cleaned = items.filter((g) => !/^(elementary|middle|high)_school$/i.test(g));
  return cleaned.length ? cleaned.join(', ') : items.join(', ');
}
