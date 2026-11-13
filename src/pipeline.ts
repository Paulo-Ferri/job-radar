import type { BoardResult, Filters, Health, Job, Latest, RawJob, State } from './types.js';
import { dedupe, isAggregator, mergeLocations } from './dedup.js';
import { classifyTitle, hasFrontendTerm, locationFilter, titleFilter } from './filters.js';
import { buildHints } from './hints.js';
import { regionHint } from './region.js';
import { isNew, updateState } from './state.js';
import { truncate } from './text.js';

export const DESCRIPTION_MAX = 6000;

export interface Rejected {
  id: string;
  company: string;
  title: string;
  location: string;
  workplace: string;
  reason: string;
  /** O título tem termo de frontend (para auditar se os filtros estão agressivos). */
  frontend_title: boolean;
}

export interface PipelineInput {
  results: BoardResult[];
  prevState: State;
  prevHealth: Health | null;
  filters: Filters;
  now: string;
}

export interface PipelineOutput {
  latest: Latest;
  state: State;
  health: Health;
  rejected: Rejected[];
  /** Vagas que passaram nos filtros, dentro ou fora da janela. */
  passed: Job[];
  /** Todas as vagas vistas, antes da deduplicação (para a descoberta de ATS). */
  allJobs: RawJob[];
}

export function runPipeline({ results, prevState, prevHealth, filters, now }: PipelineInput): PipelineOutput {
  const okBoards = results.filter((r) => r.ok).map((r) => r.board);
  const allJobs = results.filter((r) => r.ok).flatMap((r) => r.jobs);

  // O estado registra tudo o que foi visto, antes de deduplicar e filtrar. Quem não passa no
  // filtro de título fica só com id e datas (ver updateState).
  const { state } = updateState(prevState, okBoards, allJobs, now, (title, description) =>
    description === null
      ? classifyTitle(title, filters).status !== 'cut'
      : titleFilter(title, description, filters).pass,
  );

  const groups = dedupe(allJobs);
  const cutoff = Date.parse(now) - filters.window_hours * 3_600_000;
  const firstSeen = (raw: RawJob) => state.jobs[raw.id]?.first_seen_at ?? now;
  const fresh = (raw: RawJob) =>
    isNew({ published_at: raw.published_at, first_seen_at: firstSeen(raw) }, state.boards[raw.board], cutoff);
  const effective = (j: { published_at: string | null; first_seen_at: string }) =>
    Date.parse(j.published_at ?? j.first_seen_at);

  const passed: Job[] = [];
  const rejected: Rejected[] = [];
  const inWindow = new Set<string>();

  for (const group of groups) {
    // Cada anúncio do grupo (mesma vaga em locais diferentes) é julgado sozinho: um local
    // presencial ou restrito não derruba os demais, nem é salvo por eles.
    const judged = group.map((raw) => {
      const title = titleFilter(raw.title, raw.description, filters);
      const location = locationFilter(raw.workplace, raw.location, raw.description, filters);
      return { raw, reason: title.reason ?? location.reason };
    });
    const ok = judged
      .filter((j) => !j.reason)
      .map((j) => j.raw)
      .sort(
        (a, b) =>
          effective({ published_at: b.published_at, first_seen_at: firstSeen(b) }) -
            effective({ published_at: a.published_at, first_seen_at: firstSeen(a) }) || a.id.localeCompare(b.id),
      );

    if (ok.length === 0) {
      const { raw, reason } = judged[0]!;
      rejected.push({
        id: raw.id,
        company: raw.company,
        title: raw.title,
        location: mergeLocations(group.map((r) => r.location)),
        workplace: raw.workplace,
        reason: reason!,
        frontend_title: hasFrontendTerm(raw.title, filters),
      });
      continue;
    }

    // Representante: o anúncio novo mais recente, se houver; senão o mais recente dos que passam.
    const raw = ok.find(fresh) ?? ok[0]!;
    if (fresh(raw)) inWindow.add(raw.id);
    const others = group.filter((r) => !ok.includes(r));
    passed.push({
      id: raw.id,
      source: raw.source,
      company: raw.company,
      title: raw.title,
      url: raw.url,
      // Locais de todos os anúncios do grupo: primeiro os que passam no filtro, depois os demais.
      location: mergeLocations([raw, ...ok, ...others].map((r) => r.location)),
      workplace: raw.workplace,
      region_hint: regionHint(mergeLocations(ok.map((r) => r.location)), raw.description, filters.location),
      published_at: raw.published_at,
      first_seen_at: firstSeen(raw),
      date_confidence: raw.published_at ? (isAggregator(raw.source) ? 'feed' : 'ats') : 'first_seen',
      employment_type: raw.employment_type,
      salary: raw.salary,
      hints: buildHints(raw.title, raw.description),
      description: truncate(raw.description, DESCRIPTION_MAX),
    });
  }

  const jobs = passed
    .filter((j) => inWindow.has(j.id))
    .sort((a, b) => effective(b) - effective(a) || a.id.localeCompare(b.id));

  const health: Health = { generated_at: now, boards: {} };
  for (const r of results) {
    const prev = prevHealth?.boards[r.board];
    health.boards[r.board] = {
      name: r.name,
      ok: r.ok,
      jobs: r.ok ? r.jobs.length : 0,
      error: r.error,
      consecutive_failures: r.ok ? 0 : (prev?.consecutive_failures ?? 0) + 1,
      last_ok_at: r.ok ? now : (prev?.last_ok_at ?? null),
    };
  }

  const latest: Latest = {
    generated_at: now,
    window_hours: filters.window_hours,
    stats: {
      boards_ok: okBoards.length,
      boards_failed: results.length - okBoards.length,
      jobs_seen: groups.length,
      jobs_in_window: jobs.length,
    },
    jobs,
  };

  return { latest, state, health, rejected, passed, allJobs };
}
