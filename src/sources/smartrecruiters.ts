import type { Company, RawJob, Workplace } from '../types.js';
import { getJson } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';

interface SrLocation {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  fullLocation?: string | null;
}

interface SrPosting {
  id: string;
  name: string;
  releasedDate?: string | null;
  location?: SrLocation | null;
  typeOfEmployment?: { label?: string | null } | null;
  company?: { identifier?: string | null } | null;
}

interface SrDetail {
  postingUrl?: string | null;
  jobAd?: { sections?: Record<string, { title?: string | null; text?: string | null } | null> | null } | null;
}

interface SrList {
  totalFound?: number;
  content?: SrPosting[];
}

function workplace(l: SrLocation | null | undefined): Workplace {
  if (!l) return 'unknown';
  if (l.hybrid) return 'hybrid';
  if (l.remote) return 'remote';
  // remote e hybrid explicitamente falsos = presencial declarado.
  return l.remote === false && l.hybrid === false ? 'onsite' : 'unknown';
}

const SECTIONS = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation'];

export function describeSmartRecruiters(detail: SrDetail): string {
  const sections = detail.jobAd?.sections ?? {};
  return cleanText(SECTIONS.map((k) => htmlToText(sections[k]?.text)).filter(Boolean).join('\n\n'));
}

export function normalizeSmartRecruiters(
  payload: SrList,
  company: Company,
  details: Record<string, SrDetail> = {},
): RawJob[] {
  return (payload.content ?? []).map((p) => {
    const slug = p.company?.identifier ?? company.id;
    const detail = details[p.id];
    const l = p.location;
    return {
      id: `smartrecruiters:${company.id}:${p.id}`,
      source: 'smartrecruiters',
      board: `smartrecruiters:${company.id}`,
      company: company.name,
      title: cleanText(p.name),
      url: detail?.postingUrl ?? `https://jobs.smartrecruiters.com/${slug}/${p.id}`,
      location: cleanText(l?.fullLocation ?? [l?.city, l?.region, l?.country].filter(Boolean).join(', ')),
      workplace: workplace(l),
      published_at: toIso(p.releasedDate),
      employment_type: cleanText(p.typeOfEmployment?.label ?? '') || null,
      salary: null,
      description: detail ? describeSmartRecruiters(detail) : '',
    };
  });
}

const PAGE = 100;

/**
 * A listagem não traz descrição; ela exige uma chamada por vaga. Para limitar o volume,
 * só busca o detalhe das vagas para as quais `wantsDetail(título)` é verdadeiro.
 */
export async function fetchSmartRecruiters(
  company: Company,
  wantsDetail: (title: string) => boolean,
): Promise<RawJob[]> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company.id)}/postings`;
  const content: SrPosting[] = [];
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const page = await getJson<SrList>(`${base}?limit=${PAGE}&offset=${offset}`);
    content.push(...(page.content ?? []));
    if ((page.content ?? []).length < PAGE || content.length >= (page.totalFound ?? 0)) break;
  }
  const details: Record<string, SrDetail> = {};
  await Promise.all(
    content
      .filter((p) => wantsDetail(p.name))
      .map(async (p) => {
        try {
          details[p.id] = await getJson<SrDetail>(`${base}/${p.id}`);
        } catch {
          // Sem detalhe a vaga segue sem descrição; não derruba o board.
        }
      }),
  );
  return normalizeSmartRecruiters({ content }, company, details);
}
