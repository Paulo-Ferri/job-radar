import type { RawJob } from './types.js';
import { fold, normalizeCompany, normalizeTitle } from './text.js';

const AGGREGATORS = new Set(['himalayas', 'remoteok', 'wwr']);

export const isAggregator = (source: string) => AGGREGATORS.has(source);

/**
 * Devolve grupos de anúncios que são a mesma vaga.
 * 1) Mesma fonte: por id; depois, mesma empresa + mesmo título (normalizados) formam um grupo só
 *    (ex.: um anúncio por país). Quem consome o grupo decide o representante e junta os locais.
 * 2) Entre fontes: por empresa + título normalizados. Se a vaga existe em um ATS, as cópias de
 *    agregadores saem; entre agregadores fica o grupo da fonte que apareceu primeiro.
 */
export function dedupe(jobs: RawJob[]): RawJob[][] {
  const byId = new Map<string, RawJob>();
  for (const j of jobs) if (!byId.has(j.id)) byId.set(j.id, j);

  const key = (j: RawJob) => `${normalizeCompany(j.company)}|${normalizeTitle(j.title)}`;
  const groups = new Map<string, RawJob[]>();
  for (const j of byId.values()) {
    const k = `${j.source}|${key(j)}`;
    const group = groups.get(k);
    if (group) group.push(j);
    else groups.set(k, [j]);
  }

  const all = [...groups.values()];
  const atsKeys = new Set(all.filter((g) => !isAggregator(g[0]!.source)).map((g) => key(g[0]!)));
  const aggregatorKeys = new Set<string>();

  return all.filter((g) => {
    const first = g[0]!;
    if (!isAggregator(first.source)) return true;
    const k = key(first);
    if (atsKeys.has(k) || aggregatorKeys.has(k)) return false;
    aggregatorKeys.add(k);
    return true;
  });
}

/** Junta textos de local ("A; B" + "B; C" → "A; B; C"), sem repetir e na ordem recebida. */
export function mergeLocations(locations: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of locations.flatMap((l) => l.split(';'))) {
    const p = part.trim();
    const k = fold(p);
    if (!p || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out.join('; ');
}
