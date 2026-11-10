import type { Company, RawJob } from '../types.js';
import { getJson } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';

interface WorkableLocation {
  country?: string | null;
  city?: string | null;
  region?: string | null;
  hidden?: boolean;
}

interface WorkableJob {
  title: string;
  shortcode: string;
  url: string;
  employment_type?: string | null;
  telecommuting?: boolean | null;
  published_on?: string | null;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  locations?: WorkableLocation[] | null;
  description?: string | null;
}

const place = (...parts: Array<string | null | undefined>) =>
  parts.map((p) => cleanText(p ?? '')).filter(Boolean).join(', ');

export function normalizeWorkable(payload: { jobs?: WorkableJob[] }, company: Company): RawJob[] {
  return (payload.jobs ?? []).map((j) => {
    const fromList = (j.locations ?? []).filter((l) => !l.hidden).map((l) => place(l.city, l.region, l.country));
    const locations = fromList.filter(Boolean).length ? fromList : [place(j.city, j.state, j.country)];
    return {
      id: `workable:${company.id}:${j.shortcode}`,
      source: 'workable',
      board: `workable:${company.id}`,
      company: company.name,
      title: cleanText(j.title),
      url: j.url,
      location: [...new Set(locations.filter(Boolean))].join('; '),
      // A API pública só diz se é remoto (telecommuting); híbrido/presencial não são distinguíveis.
      workplace: j.telecommuting ? 'remote' : 'unknown',
      // published_on tem precisão de dia: vira 00:00 UTC.
      published_at: toIso(j.published_on),
      employment_type: cleanText(j.employment_type ?? '') || null,
      salary: null,
      description: htmlToText(j.description),
    };
  });
}

export async function fetchWorkable(company: Company): Promise<RawJob[]> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(company.id)}?details=true`;
  return normalizeWorkable(await getJson(url), company);
}
