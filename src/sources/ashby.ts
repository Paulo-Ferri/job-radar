import type { Company, RawJob, Workplace } from '../types.js';
import { getJson } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';

interface AshbyJob {
  id: string;
  title: string;
  location?: string | null;
  secondaryLocations?: Array<{ location?: string | null }> | null;
  employmentType?: string | null;
  publishedAt?: string | null;
  isListed?: boolean;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  jobUrl: string;
  descriptionPlain?: string | null;
  descriptionHtml?: string | null;
  compensation?: {
    compensationTierSummary?: string | null;
    scrapeableCompensationSalarySummary?: string | null;
  } | null;
}

function workplace(j: AshbyJob): Workplace {
  const w = (j.workplaceType ?? '').toLowerCase();
  if (w === 'remote') return 'remote';
  if (w === 'hybrid') return 'hybrid';
  if (w === 'onsite' || w === 'on-site') return 'onsite';
  return j.isRemote ? 'remote' : 'unknown';
}

export function normalizeAshby(payload: { jobs?: AshbyJob[] }, company: Company): RawJob[] {
  return (payload.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const locations = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)]
        .map((l) => cleanText(l ?? ''))
        .filter(Boolean);
      return {
        id: `ashby:${company.id}:${j.id}`,
        source: 'ashby',
        board: `ashby:${company.id}`,
        company: company.name,
        title: cleanText(j.title),
        url: j.jobUrl,
        location: [...new Set(locations)].join('; '),
        workplace: workplace(j),
        published_at: toIso(j.publishedAt),
        employment_type: j.employmentType ?? null,
        salary:
          cleanText(j.compensation?.compensationTierSummary ?? j.compensation?.scrapeableCompensationSalarySummary ?? '') ||
          null,
        description: j.descriptionPlain ? cleanText(j.descriptionPlain) : htmlToText(j.descriptionHtml),
      };
    });
}

export async function fetchAshby(company: Company): Promise<RawJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.id)}?includeCompensation=true`;
  return normalizeAshby(await getJson(url), company);
}
