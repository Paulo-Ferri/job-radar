const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', deg: '°', euro: '€', pound: '£',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', atilde: 'ã', otilde: 'õ',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', ccedil: 'ç', agrave: 'à', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ',
  Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Ccedil: 'Ç', Agrave: 'À', Ntilde: 'Ñ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? m;
  });
}

/** Converte HTML (inclusive HTML escapado, como o do Greenhouse) em texto puro. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = decodeEntities(html);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return cleanText(s);
}

export function cleanText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/\r/g, '')
    .replace(/[ \t ​]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Minúsculas e sem acentos. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex de um termo com fronteira de palavra ("java" não casa "javascript"). */
export function termRegex(term: string, flags = ''): RegExp {
  return new RegExp(`(?<![a-z0-9])${escapeRe(term)}(?![a-z0-9])`, flags);
}

/** Primeiro termo da lista presente no texto (já "foldado"), ou null. */
export function findTerm(foldedText: string, terms: string[]): string | null {
  for (const t of terms) {
    if (termRegex(fold(t)).test(foldedText)) return t;
  }
  return null;
}

const COMPANY_SUFFIX = /\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|sa|s a|ltda|plc|bv|ag)\b/g;

export function normalizeCompany(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, ' ').replace(COMPANY_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(s: string): string {
  return fold(s).replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function toIso(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
