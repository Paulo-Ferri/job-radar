import type { Filters, RawJob } from '../types.js';
import { errorCode, getJson } from '../http.js';
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
/** Pausa entre páginas: a API responde 429 a rajadas. */
const PAUSE_MS = 1_500;
/** Em 429: até 4 novas tentativas por página, esperando 10, 20, 40 e 60 s (ou o Retry-After, até 60 s). */
const RETRY = { retries: 4, maxRetryAfter: 60, backoff429: (attempt: number) => Math.min(10 * 2 ** attempt, 60) };

export interface HimalayasResult {
  jobs: RawJob[];
  /** Código do erro que interrompeu a busca; com `jobs` não vazio, o resultado é parcial. */
  error: string | null;
}

/**
 * Busca por termos, da mais recente para a mais antiga. Para cada termo, para quando a página
 * inteira já está fora da janela, quando acaba, ou no teto de páginas. Se uma página falha mesmo
 * depois das novas tentativas, a busca para e devolve o que já tinha coletado junto com o erro.
 */
export async function fetchHimalayas(
  cfg: Filters['himalayas'],
  cutoffMs: number,
  pauseMs = PAUSE_MS,
): Promise<HimalayasResult> {
  const byId = new Map<string, RawJob>();
  const pause = () => new Promise((r) => setTimeout(r, pauseMs));
  // Uma requisição por vez, com pausa.
  for (const [i, term] of cfg.search_terms.entries()) {
    if (i > 0) await pause();
    for (let page = 1; page <= cfg.max_pages_per_term; page++) {
      if (page > 1) await pause();
      const url = `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(term)}&sort=recent&page=${page}`;
      let payload: HimalayasPage;
      try {
        payload = await getJson<HimalayasPage>(url, RETRY);
      } catch (e) {
        return { jobs: [...byId.values()], error: errorCode(e) };
      }
      const raw = payload.jobs ?? [];
      for (const job of normalizeHimalayas(payload)) byId.set(job.id, job);
      const anyInWindow = raw.some((j) => (j.pubDate ?? 0) * 1000 >= cutoffMs);
      if (raw.length < PAGE_SIZE || !anyInWindow) break;
    }
  }
  return { jobs: [...byId.values()], error: null };
}
