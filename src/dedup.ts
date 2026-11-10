import type { RawJob } from './types.js';
import { normalizeCompany, normalizeTitle } from './text.js';

const AGGREGATORS = new Set(['himalayas', 'remoteok', 'wwr']);

export const isAggregator = (source: string) => AGGREGATORS.has(source);

/**
 * 1) Mesma fonte: por id.
 * 2) Entre fontes: por empresa + título normalizados. Se a vaga existe em um ATS, as cópias de
 *    agregadores saem; entre agregadores fica a primeira que apareceu. Vagas de um mesmo ATS
 *    com o mesmo título (ex.: uma por país) são mantidas.
 */
export function dedupe(jobs: RawJob[]): RawJob[] {
  const byId = new Map<string, RawJob>();
  for (const j of jobs) if (!byId.has(j.id)) byId.set(j.id, j);
  const unique = [...byId.values()];

  const key = (j: RawJob) => `${normalizeCompany(j.company)}|${normalizeTitle(j.title)}`;
  const atsKeys = new Set(unique.filter((j) => !isAggregator(j.source)).map(key));
  const aggregatorKeys = new Set<string>();

  return unique.filter((j) => {
    if (!isAggregator(j.source)) return true;
    const k = key(j);
    if (atsKeys.has(k) || aggregatorKeys.has(k)) return false;
    aggregatorKeys.add(k);
    return true;
  });
}
