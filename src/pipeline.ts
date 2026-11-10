import type { BoardResult, Filters, Health, Job, Latest, RawJob, State } from './types.js';
import { dedupe, isAggregator } from './dedup.js';
import { hasFrontendTerm, locationFilter, titleFilter } from './filters.js';
import { buildHints } from './hints.js';
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

  // O estado registra tudo o que foi visto, antes de deduplicar e filtrar.
  const { state } = updateState(prevState, okBoards, allJobs, now);

  const unique = dedupe(allJobs);
  const passed: Job[] = [];
  const rejected: Rejected[] = [];

  for (const raw of unique) {
    const title = titleFilter(raw.title, raw.description, filters);
    const location = locationFilter(raw.workplace, raw.location, raw.description, filters);
    const reason = title.reason ?? location.reason;
    if (reason) {
      rejected.push({
        id: raw.id,
        company: raw.company,
        title: raw.title,
        location: raw.location,
        workplace: raw.workplace,
        reason,
        frontend_title: hasFrontendTerm(raw.title, filters),
      });
      continue;
    }
    passed.push({
      id: raw.id,
      source: raw.source,
      company: raw.company,
      title: raw.title,
      url: raw.url,
      location: raw.location,
      workplace: raw.workplace,
      region_hint: location.region_hint,
      published_at: raw.published_at,
      first_seen_at: state.jobs[raw.id]?.first_seen_at ?? now,
      date_confidence: raw.published_at ? (isAggregator(raw.source) ? 'feed' : 'ats') : 'first_seen',
      employment_type: raw.employment_type,
      salary: raw.salary,
      hints: buildHints(raw.title, raw.description),
      description: truncate(raw.description, DESCRIPTION_MAX),
    });
  }

  const boardOf = new Map(unique.map((j) => [j.id, j.board]));
  const cutoff = Date.parse(now) - filters.window_hours * 3_600_000;
  const effective = (j: Job) => Date.parse(j.published_at ?? j.first_seen_at);
  const jobs = passed
    .filter((j) => isNew(j, state.boards[boardOf.get(j.id) ?? ''], cutoff))
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
      jobs_seen: unique.length,
      jobs_in_window: jobs.length,
    },
    jobs,
  };

  return { latest, state, health, rejected, passed, allJobs };
}
