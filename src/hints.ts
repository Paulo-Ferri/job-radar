import type { Job } from './types.js';

const RANGE = /(?<!\d)(\d{1,2})\s*\+?\s*(?:-|–|—|to|a|até)\s*(\d{1,2})\s*\+?\s*(?:years|year|yrs|yr|anos|ano)(?![a-z])(?!\s*(?:ago|old|atr[aá]s))/gi;
const SINGLE = /(?<!\d)(\d{1,2})\s*\+?\s*(?:years|year|yrs|yr|anos|ano)(?![a-z])(?!\s*(?:ago|old|atr[aá]s))/gi;

/** Números de anos de experiência citados ("5+ years", "3 anos de experiência", "3-5 years"). */
export function extractYears(text: string): number[] {
  const found = new Set<number>();
  const add = (n: string | undefined) => {
    const v = Number(n);
    if (Number.isInteger(v) && v >= 1 && v <= 20) found.add(v);
  };
  for (const m of text.matchAll(RANGE)) {
    add(m[1]);
    add(m[2]);
  }
  for (const m of text.matchAll(SINGLE)) add(m[1]);
  return [...found].sort((a, b) => a - b);
}

export const mentionsReact = (text: string) => /(?<![a-z0-9])react(?:\.?js)?(?![a-z0-9])/i.test(text);
export const mentionsTypescript = (text: string) => /(?<![a-z0-9])typescript(?![a-z0-9])/i.test(text);

export function buildHints(title: string, description: string): Job['hints'] {
  const text = `${title}\n${description}`;
  return {
    years: extractYears(description),
    mentions_react: mentionsReact(text),
    mentions_typescript: mentionsTypescript(text),
  };
}
