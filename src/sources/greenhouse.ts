import type { Company, RawJob } from '../types.js';
import { getJson } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';
import { inferWorkplace } from '../region.js';

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  first_published?: string | null;
  location?: { name?: string | null } | null;
  offices?: Array<{ name?: string | null; location?: string | null }> | null;
  content?: string | null;
  company_name?: string | null;
}

export function normalizeGreenhouse(payload: { jobs?: GhJob[] }, company: Company): RawJob[] {
  return (payload.jobs ?? []).map((j) => {
    const location = cleanText(j.location?.name ?? '');
    return {
      id: `greenhouse:${company.id}:${j.id}`,
      source: 'greenhouse',
      board: `greenhouse:${company.id}`,
      company: company.name,
      title: cleanText(j.title),
      url: j.absolute_url,
      location,
      // O Greenhouse não tem campo de modalidade: vem (quando vem) no texto do local.
      workplace: inferWorkplace(location),
      // first_published é a data de publicação; updated_at muda a cada edição e não é usado.
      published_at: toIso(j.first_published),
      employment_type: null,
      salary: null,
      description: htmlToText(j.content),
    };
  });
}

export async function fetchGreenhouse(company: Company): Promise<RawJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.id)}/jobs?content=true`;
  return normalizeGreenhouse(await getJson(url), company);
}
