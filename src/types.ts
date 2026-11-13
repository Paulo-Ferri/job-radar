export type Workplace = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type RegionHint = 'brazil' | 'latam' | 'americas' | 'worldwide' | 'restricted' | 'unknown';
export type DateConfidence = 'ats' | 'feed' | 'first_seen';

export type AtsName = 'greenhouse' | 'ashby' | 'lever' | 'workable' | 'smartrecruiters' | 'recruitee' | 'inhire';

export interface Company {
  name: string;
  ats: AtsName;
  id: string;
}

/** Vaga normalizada por um adaptador, antes de filtros e estado. */
export interface RawJob {
  id: string;
  source: string;
  /** Chave do board/fonte, ex.: "greenhouse:gitlab" ou "himalayas". */
  board: string;
  company: string;
  title: string;
  url: string;
  location: string;
  workplace: Workplace;
  published_at: string | null;
  employment_type: string | null;
  salary: string | null;
  /** Texto puro completo (sem corte). */
  description: string;
  /** Links de ATS encontrados no link de candidatura/descrição (só agregadores). */
  ats_links?: AtsLink[];
}

export interface AtsLink {
  ats: 'greenhouse' | 'ashby' | 'lever';
  id: string;
}

/** Vaga no formato do contrato de data/latest.json. */
export interface Job {
  id: string;
  source: string;
  company: string;
  title: string;
  url: string;
  location: string;
  workplace: Workplace;
  region_hint: RegionHint;
  published_at: string | null;
  first_seen_at: string;
  date_confidence: DateConfidence;
  employment_type: string | null;
  salary: string | null;
  hints: { years: number[]; mentions_react: boolean; mentions_typescript: boolean };
  description: string;
}

export interface Latest {
  generated_at: string;
  window_hours: number;
  stats: { boards_ok: number; boards_failed: number; jobs_seen: number; jobs_in_window: number };
  jobs: Job[];
}

export interface StateJob {
  id: string;
  /** company, title e url só existem para vagas que passam no filtro de título. */
  company?: string;
  title?: string;
  url?: string;
  first_seen_at: string;
  closed_at: string | null;
}

export interface State {
  /** Boards/fontes que já tiveram uma coleta bem-sucedida (linha de base) e quando. */
  boards: Record<string, string>;
  jobs: Record<string, StateJob>;
}

export interface BoardHealth {
  name: string;
  ok: boolean;
  jobs: number;
  error: string | null;
  consecutive_failures: number;
  last_ok_at: string | null;
}

export interface Health {
  generated_at: string;
  boards: Record<string, BoardHealth>;
}

export interface BoardResult {
  board: string;
  name: string;
  ok: boolean;
  jobs: RawJob[];
  error: string | null;
}

export interface Filters {
  window_hours: number;
  title: {
    frontend_terms: string[];
    strong_frontend_terms: string[];
    generic_titles: string[];
    generic_requires_description_terms: string[];
    cut_always: { level: string[]; stack: string[] };
    cut_unless_strong_frontend: string[];
  };
  location: {
    /** Valem no local e na descrição. */
    brazil_terms: string[];
    latam_terms: string[];
    /** Cidades e países: valem só no campo de local (na descrição dariam falso positivo). */
    brazil_places: string[];
    latam_places: string[];
    americas_terms: string[];
    worldwide_terms: string[];
    restricted_terms: string[];
    /** Siglas comparadas com maiúsculas/minúsculas preservadas (US, UK, EU...). */
    restricted_case_sensitive: string[];
  };
  himalayas: { search_terms: string[]; max_pages_per_term: number };
}

export interface Discovered {
  name: string;
  ats: string;
  id: string;
  first_seen_at: string;
}
