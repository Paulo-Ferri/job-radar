import type { AtsLink, Company, Discovered, RawJob } from './types.js';

const PATTERNS: Array<{ ats: AtsLink['ats']; re: RegExp }> = [
  { ats: 'greenhouse', re: /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_app\?for=)?([a-z0-9_-]+)/gi },
  { ats: 'ashby', re: /jobs\.ashbyhq\.com\/([a-z0-9._%-]+)/gi },
  { ats: 'lever', re: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9._-]+)/gi },
];

const IGNORED = new Set(['embed', 'api', 'v1']);

/** Extrai (ats, id) de qualquer link de Greenhouse, Ashby ou Lever presente no texto. */
export function extractAtsLinks(text: string | null | undefined): AtsLink[] {
  if (!text) return [];
  const out = new Map<string, AtsLink>();
  for (const { ats, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      let id = m[1];
      if (!id) continue;
      try {
        id = decodeURIComponent(id);
      } catch {
        /* mantém como veio */
      }
      id = id.toLowerCase();
      if (IGNORED.has(id)) continue;
      out.set(`${ats}:${id}`, { ats, id });
    }
  }
  return [...out.values()];
}

/** Acrescenta a data/discovered.json os boards de ATS vistos em agregadores e ausentes de companies.json. */
export function updateDiscovered(
  previous: Discovered[],
  jobs: RawJob[],
  companies: Company[],
  now: string,
): Discovered[] {
  const known = new Set(companies.map((c) => `${c.ats}:${c.id.toLowerCase()}`));
  const seen = new Set(previous.map((d) => `${d.ats}:${d.id}`));
  const out = [...previous];
  for (const job of jobs) {
    for (const link of job.ats_links ?? []) {
      const key = `${link.ats}:${link.id}`;
      if (known.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ name: job.company, ats: link.ats, id: link.id, first_seen_at: now });
    }
  }
  return out;
}
