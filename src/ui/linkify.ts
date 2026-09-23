// Zerlegt Text in Text- und Link-Segmente. Nur http/https, keine Vorschauen.
// Gerendert wird ausschließlich als Text bzw. <a> mit rel="noopener noreferrer" – nie als HTML.

export type Segment = { type: 'text'; value: string } | { type: 'link'; value: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}'"»“”’]+$/;

export function splitLinks(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let candidate = match[0];
    const trailing = TRAILING.exec(candidate);
    if (trailing) candidate = candidate.slice(0, candidate.length - trailing[0].length);
    let href: string | null = null;
    try {
      const url = new URL(candidate);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0) href = url.href;
    } catch {
      href = null;
    }
    if (!href) continue;
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
    out.push({ type: 'link', value: candidate, href });
    last = start + candidate.length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}
