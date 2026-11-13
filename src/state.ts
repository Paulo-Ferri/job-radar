import type { RawJob, State, StateJob } from './types.js';
import { isAggregator } from './dedup.js';

export const PRUNE_DAYS = 90;
/** Retenção das vagas fechadas que não passam no filtro de título (entradas só com id e datas). */
export const PRUNE_DAYS_SLIM = 14;
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
 * A vaga passa no filtro de título? `description` é null para entradas que não vieram nesta
 * coleta (só o título guardado está disponível).
 */
export type KeepDetails = (title: string, description: string | null) => boolean;

/**
 * Aplica uma execução ao estado.
 * - Vaga nova: entra com first_seen_at = agora. Vaga que reaparece: closed_at volta a null.
 * - Só fecha (closed_at = agora) vaga de board cuja consulta deu certo e que não veio na resposta.
 * - Board com falha não muda nada nas suas vagas nem ganha linha de base.
 * - Remove vagas fechadas há mais de 90 dias; as que não passam no filtro de título, há mais de 14.
 * - Vaga que não passa no filtro de título (`keepDetails` falso) fica só com id, first_seen_at e
 *   closed_at: é a grande maioria, e o que ela precisa guardar é só quando foi vista.
 */
export function updateState(
  prev: State,
  okBoards: string[],
  jobs: RawJob[],
  now: string,
  keepDetails: KeepDetails = () => true,
): StateUpdate {
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
    const details = keepDetails(j.title, j.description) ? { company: j.company, title: j.title, url: j.url } : {};
    next[j.id] = {
      id: j.id,
      ...details,
      first_seen_at: existing?.first_seen_at ?? now,
      closed_at: null,
    };
  }

  const nowMs = Date.parse(now);
  for (const id of Object.keys(next)) {
    let j = next[id]!;
    if (!seen.has(id)) {
      if (j.closed_at === null && ok.has(boardOfId(id))) j.closed_at = now;
      // Entradas antigas (ou de board com falha) que não passam pelo título também perdem os detalhes.
      if (j.title !== undefined && !keepDetails(j.title, null)) {
        j = next[id] = { id: j.id, first_seen_at: j.first_seen_at, closed_at: j.closed_at };
      }
    }
    const days = j.title === undefined ? PRUNE_DAYS_SLIM : PRUNE_DAYS;
    if (j.closed_at !== null && Date.parse(j.closed_at) < nowMs - days * DAY_MS) delete next[id];
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
