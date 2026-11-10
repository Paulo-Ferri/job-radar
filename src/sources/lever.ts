import type { Company, RawJob, Workplace } from '../types.js';
import { getJson, HttpError } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';

interface LeverJob {
  id: string;
  text: string;
  createdAt?: number | null;
  hostedUrl: string;
  workplaceType?: string | null;
  categories?: { commitment?: string | null; location?: string | null; allLocations?: string[] | null } | null;
  descriptionPlain?: string | null;
  lists?: Array<{ text?: string | null; content?: string | null }> | null;
  additionalPlain?: string | null;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } | null;
  salaryDescriptionPlain?: string | null;
}

function workplace(w: string | null | undefined): Workplace {
  switch ((w ?? '').toLowerCase()) {
    case 'remote':
      return 'remote';
    case 'hybrid':
      return 'hybrid';
    case 'on-site':
    case 'onsite':
      return 'onsite';
    default:
      return 'unknown';
  }
}

function salary(j: LeverJob): string | null {
  const r = j.salaryRange;
  const range =
    r && (r.min || r.max)
      ? [[r.min, r.max].filter((n) => n != null).join(' - '), r.currency, r.interval].filter(Boolean).join(' ')
      : '';
  return [range, cleanText(j.salaryDescriptionPlain ?? '')].filter(Boolean).join(' | ') || null;
}

export function normalizeLever(payload: LeverJob[], company: Company): RawJob[] {
  return payload.map((j) => {
    const locations = j.categories?.allLocations?.length ? j.categories.allLocations : [j.categories?.location ?? ''];
    const lists = (j.lists ?? []).map((l) => `${cleanText(l.text ?? '')}\n${htmlToText(l.content)}`);
    return {
      id: `lever:${company.id}:${j.id}`,
      source: 'lever',
      board: `lever:${company.id}`,
      company: company.name,
      title: cleanText(j.text),
      url: j.hostedUrl,
      location: locations.map((l) => cleanText(l)).filter(Boolean).join('; '),
      workplace: workplace(j.workplaceType),
      // createdAt (epoch ms) pode ser anterior à publicação real; o first_seen_at cobre esse caso.
      published_at: toIso(j.createdAt),
      employment_type: cleanText(j.categories?.commitment ?? '') || null,
      salary: salary(j),
      description: cleanText([j.descriptionPlain ?? '', ...lists, j.additionalPlain ?? ''].join('\n\n')),
    };
  });
}

export async function fetchLever(company: Company): Promise<RawJob[]> {
  const path = `/v0/postings/${encodeURIComponent(company.id)}?mode=json`;
  let payload: LeverJob[];
  try {
    payload = await getJson<LeverJob[]>(`https://api.lever.co${path}`);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404) throw e;
    // Site inexistente na instância global: tenta a europeia.
    payload = await getJson<LeverJob[]>(`https://api.eu.lever.co${path}`);
  }
  if (!Array.isArray(payload)) throw new HttpError('parse', null, path);
  return normalizeLever(payload, company);
}
