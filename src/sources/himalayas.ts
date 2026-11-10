import type { Filters, RawJob } from '../types.js';
import { getJson } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';
import { extractAtsLinks } from '../discover.js';

interface HimalayasJob {
  title: string;
  companyName: string;
  companySlug?: string | null;
  employmentType?: string | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string | null;
  currency?: string | null;
  locationRestrictions?: string[] | null;
  /** Epoch em segundos. */
  pubDate?: number | null;
  applicationLink?: string | null;
  guid: string;
  description?: string | null;
}

interface HimalayasPage {
  jobs?: HimalayasJob[];
}

function salary(j: HimalayasJob): string | null {
  if (!j.minSalary && !j.maxSalary) return null;
  const range = [j.minSalary, j.maxSalary].filter((n) => n != null && n > 0).join(' - ');
  return [range, j.currency, j.salaryPeriod].filter(Boolean).join(' ');
}

export function normalizeHimalayas(payload: HimalayasPage): RawJob[] {
  return (payload.jobs ?? []).map((j) => {
    const slug = j.guid.replace(/^https?:\/\/[^/]+\/companies\//, '').replace(/\/jobs\//, '/');
    const restrictions = (j.locationRestrictions ?? []).map((l) => cleanText(l)).filter(Boolean);
    return {
      id: `himalayas:${slug}`,
      source: 'himalayas',
      board: 'himalayas',
      company: cleanText(j.companyName),
      title: cleanText(j.title),
      url: j.guid,
      // Sem restrição de local, o Himalayas trata a vaga como aberta ao mundo todo.
      location: restrictions.length ? restrictions.join(', ') : 'Worldwide',
      workplace: 'remote',
      published_at: j.pubDate ? toIso(j.pubDate * 1000) : null,
      employment_type: cleanText(j.employmentType ?? '') || null,
      salary: salary(j),
      description: htmlToText(j.description),
      ats_links: extractAtsLinks(`${j.applicationLink ?? ''} ${j.description ?? ''}`),
    };
  });
}

const PAGE_SIZE = 20;
const PAUSE_MS = 400;

/**
 * Busca por termos, da mais recente para a mais antiga. Para cada termo, para quando a página
 * inteira já está fora da janela, quando acaba, ou no teto de páginas.
 */
export async function fetchHimalayas(cfg: Filters['himalayas'], cutoffMs: number): Promise<RawJob[]> {
  const byId = new Map<string, RawJob>();
  // Uma requisição por vez, com pausa: a API responde 429 a rajadas.
  for (const term of cfg.search_terms) {
    for (let page = 1; page <= cfg.max_pages_per_term; page++) {
      const url = `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(term)}&sort=recent&page=${page}`;
      const payload = await getJson<HimalayasPage>(url);
      const raw = payload.jobs ?? [];
      for (const job of normalizeHimalayas(payload)) byId.set(job.id, job);
      const anyInWindow = raw.some((j) => (j.pubDate ?? 0) * 1000 >= cutoffMs);
      if (raw.length < PAGE_SIZE || !anyInWindow) break;
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }
  return [...byId.values()];
}
