import type { RawJob, State, StateJob } from './types.js';
import { isAggregator } from './dedup.js';

export const PRUNE_DAYS = 90;
const DAY_MS = 86_400_000;

export const emptyState = (): State => ({ boards: {}, jobs: {} });

/** Board de uma vaga a partir do id: "greenhouse:gitlab:123" → "greenhouse:gitlab"; "wwr:x" → "wwr". */
export function boardOfId(id: string): string {
  const [source = '', second = ''] = id.split(':');
  return isAggregator(source) ? source : `${source}:${second}`;
}

export interface StateUpdate {
  state: State;
}

/**
 * Aplica uma execução ao estado.
 * - Vaga nova: entra com first_seen_at = agora. Vaga que reaparece: closed_at volta a null.
 * - Só fecha (closed_at = agora) vaga de board cuja consulta deu certo e que não veio na resposta.
 * - Board com falha não muda nada nas suas vagas nem ganha linha de base.
 * - Remove vagas fechadas há mais de 90 dias.
 */
export function updateState(prev: State, okBoards: string[], jobs: RawJob[], now: string): StateUpdate {
  const ok = new Set(okBoards);
  const boards = { ...prev.boards };
  for (const b of okBoards) boards[b] ??= now;

  const next: Record<string, StateJob> = {};
  for (const [id, j] of Object.entries(prev.jobs)) next[id] = { ...j };

  const seen = new Set<string>();
  for (const j of jobs) {
    if (!ok.has(j.board)) continue;
    seen.add(j.id);
    const existing = next[j.id];
    if (existing) {
      existing.closed_at = null;
      existing.company = j.company;
      existing.title = j.title;
      existing.url = j.url;
    } else {
      next[j.id] = { id: j.id, company: j.company, title: j.title, url: j.url, first_seen_at: now, closed_at: null };
    }
  }

  const pruneBefore = Date.parse(now) - PRUNE_DAYS * DAY_MS;
  for (const [id, j] of Object.entries(next)) {
    if (!seen.has(id) && j.closed_at === null && ok.has(boardOfId(id))) j.closed_at = now;
    if (j.closed_at !== null && Date.parse(j.closed_at) < pruneBefore) delete next[id];
  }

  return { state: { boards, jobs: next } };
}

/**
 * Vaga nova = published_at dentro da janela OU (board já tinha linha de base quando a vaga
 * apareceu E first_seen_at dentro da janela). `baselineAt` é o momento da primeira coleta
 * bem-sucedida do board: as vagas vistas nessa coleta (first_seen_at == baselineAt) nunca
 * contam como novidade pelo first_seen_at, com ou sem data de fonte.
 */
export function isNew(
  job: { published_at: string | null; first_seen_at: string },
  baselineAt: string | null | undefined,
  cutoffMs: number,
): boolean {
  if (job.published_at !== null && Date.parse(job.published_at) >= cutoffMs) return true;
  if (!baselineAt) return false;
  const firstSeen = Date.parse(job.first_seen_at);
  return firstSeen > Date.parse(baselineAt) && firstSeen >= cutoffMs;
}
