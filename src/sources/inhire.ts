import type { Company, RawJob, Workplace } from '../types.js';
import { HttpError } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';

interface InhireListItem {
  jobId: string;
  displayName: string;
  status?: string | null;
  workplaceType?: string | null;
  location?: string | null;
}

interface InhireList {
  tenantName?: string | null;
  jobsPage?: InhireListItem[] | null;
}

interface InhireDetail {
  publishedAt?: string | null;
  createdAt?: string | null;
  description?: string | null;
  contractType?: string[] | string | null;
  locationComplement?: string | null;
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

const countryName = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * O InHire escreve o local como "São Paulo, SP, BR" ou só "BR". Troca o código do país pelo nome
 * ("São Paulo, SP, Brazil") para os filtros de local reconhecerem. Só mexe no formato
 * cidade/estado/país ou país sozinho, para não confundir sigla de estado com país.
 */
export function expandCountry(location: string): string {
  const parts = location.split(',').map((p) => p.trim());
  const last = parts[parts.length - 1] ?? '';
  if ((parts.length !== 1 && parts.length !== 3) || !/^[A-Z]{2}$/.test(last)) return location;
  let name: string | undefined;
  try {
    name = countryName.of(last);
  } catch {
    return location;
  }
  if (!name || name === last) return location;
  return [...parts.slice(0, -1), name].join(', ');
}

export function normalizeInhire(
  payload: InhireList,
  company: Company,
  details: Record<string, InhireDetail> = {},
): RawJob[] {
  return (payload.jobsPage ?? [])
    .filter((j) => j.status === 'published')
    .map((j) => {
      const detail = details[j.jobId];
      const contract = detail?.contractType;
      const base = expandCountry(cleanText(j.location ?? ''));
      // O complemento costuma dizer os dias presenciais das híbridas; fica junto do local.
      const complement = cleanText(detail?.locationComplement ?? '').replace(/\s*\n\s*/g, ' ');
      return {
        id: `inhire:${company.id}:${j.jobId}`,
        source: 'inhire',
        board: `inhire:${company.id}`,
        company: company.name,
        title: cleanText(j.displayName),
        url: `https://${company.id}.inhire.app/vagas/${j.jobId}`,
        location: [base, complement].filter(Boolean).join(' · '),
        workplace: workplace(j.workplaceType),
        // lastPublishedAt e updatedAt mudam a cada republicação/edição e não são usados.
        published_at: toIso(detail?.publishedAt) ?? toIso(detail?.createdAt),
        employment_type: (Array.isArray(contract) ? contract.join(', ') : cleanText(contract ?? '')) || null,
        salary: null,
        description: htmlToText(detail?.description),
      };
    });
}

const API = 'https://api.inhire.app/job-posts/public/pages';
const USER_AGENT = 'job-radar/1.0';
const TIMEOUT_MS = 20_000;
const MAX_CONCURRENCY = 2;
const PAUSE_MS = 400;

let active = 0;
const queue: Array<() => void> = [];

/**
 * GET próprio do InHire, compartilhado por todos os tenants: no máximo 2 chamadas ao mesmo tempo
 * e uma pausa depois de cada uma. Sem nova tentativa em 429: insistir é o que leva a bloqueio de IP.
 */
async function get<T>(url: string, tenant: string): Promise<T> {
  if (active >= MAX_CONCURRENCY) await new Promise<void>((resolve) => queue.push(resolve));
  active++;
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'X-Tenant': tenant },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const name = (e as Error).name;
      throw new HttpError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', null, url);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpError(`http_${res.status}`, res.status, url);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new HttpError('parse', null, url);
    }
  } finally {
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    active--;
    queue.shift()?.();
  }
}

/**
 * A listagem não traz data nem descrição; elas exigem uma chamada por vaga. Só busca o detalhe
 * das vagas para as quais `wantsDetail` é verdadeiro (título e modalidade que podem passar).
 * `company.id` é o tenant: o subdomínio de {tenant}.inhire.app.
 */
export async function fetchInhire(
  company: Company,
  wantsDetail: (title: string, workplace: Workplace, location: string) => boolean,
): Promise<RawJob[]> {
  const list = await get<InhireList>(API, company.id);
  if (!Array.isArray(list.jobsPage)) throw new HttpError('parse', null, API);
  const wanted = normalizeInhire(list, company).filter((j) => wantsDetail(j.title, j.workplace, j.location));
  const details: Record<string, InhireDetail> = {};
  await Promise.all(
    wanted.map(async (j) => {
      const jobId = j.id.slice(`inhire:${company.id}:`.length);
      try {
        details[jobId] = await get<InhireDetail>(`${API}/${jobId}`, company.id);
      } catch {
        // Sem detalhe a vaga segue sem data e sem descrição; não derruba o board.
      }
    }),
  );
  return normalizeInhire(list, company, details);
}
