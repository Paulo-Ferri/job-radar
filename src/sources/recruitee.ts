import type { Company, RawJob, Workplace } from '../types.js';
import { getJson } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';

interface RecruiteeOffer {
  id: number;
  title: string;
  status?: string | null;
  published_at?: string | null;
  careers_url: string;
  location?: string | null;
  locations?: Array<{ name?: string | null }> | null;
  city?: string | null;
  country?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  on_site?: boolean | null;
  employment_type_code?: string | null;
  salary?: { min?: string | number | null; max?: string | number | null; period?: string | null; currency?: string | null } | null;
  description?: string | null;
  requirements?: string | null;
}

function workplace(o: RecruiteeOffer): Workplace {
  if (o.remote) return 'remote';
  if (o.hybrid) return 'hybrid';
  if (o.on_site) return 'onsite';
  return 'unknown';
}

function salary(o: RecruiteeOffer): string | null {
  const s = o.salary;
  if (!s || (s.min == null && s.max == null)) return null;
  return [[s.min, s.max].filter((n) => n != null).join(' - '), s.currency, s.period].filter(Boolean).join(' ');
}

/** "2026-11-09 14:37:49 UTC" → ISO. */
const parseDate = (s: string | null | undefined) =>
  s ? toIso(s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, '$1T$2Z')) : null;

export function normalizeRecruitee(payload: { offers?: RecruiteeOffer[] }, company: Company): RawJob[] {
  return (payload.offers ?? [])
    .filter((o) => !o.status || o.status === 'published')
    .map((o) => {
      const named = (o.locations ?? []).map((l) => cleanText(l.name ?? '')).filter(Boolean);
      const places = named.length ? named : [[o.city, o.country].filter(Boolean).join(', ')];
      // "location" costuma ser um rótulo ("Remote job"); os países ficam em "locations".
      const location = [...new Set([cleanText(o.location ?? ''), ...places].filter(Boolean))].join('; ');
      return {
        id: `recruitee:${company.id}:${o.id}`,
        source: 'recruitee',
        board: `recruitee:${company.id}`,
        company: company.name,
        title: cleanText(o.title),
        url: o.careers_url,
        location,
        workplace: workplace(o),
        published_at: parseDate(o.published_at),
        employment_type: o.employment_type_code ?? null,
        salary: salary(o),
        description: cleanText([htmlToText(o.description), htmlToText(o.requirements)].filter(Boolean).join('\n\n')),
      };
    });
}

export async function fetchRecruitee(company: Company): Promise<RawJob[]> {
  const url = `https://${encodeURIComponent(company.id)}.recruitee.com/api/offers/`;
  return normalizeRecruitee(await getJson(url), company);
}
