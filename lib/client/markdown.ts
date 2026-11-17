// Tiny markdown for planner replies (bold, bullets, paragraphs) — ported from the prototype.
// Input is HTML-escaped first, so model output can never inject markup.

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function md(s: string): string {
  const h = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let o = '';
  let ul = false;
  for (const l of h.split('\n')) {
    const m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (m) {
      if (!ul) {
        o += '<ul>';
        ul = true;
      }
      o += '<li>' + m[1] + '</li>';
    } else {
      if (ul) {
        o += '</ul>';
        ul = false;
      }
      if (l.trim()) o += '<p>' + l.replace(/^#+\s*/, '') + '</p>';
    }
  }
  return o + (ul ? '</ul>' : '');
}
