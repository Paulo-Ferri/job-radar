import type { Filters, RegionHint, Workplace } from './types.js';
import { findTerm, fold } from './text.js';
import { regionHint } from './region.js';

export type TitleClass =
  | { status: 'pass' }
  /** Título genérico: só passa se a descrição citar React ou TypeScript. */
  | { status: 'generic' }
  | { status: 'cut'; reason: string };

export interface Verdict {
  pass: boolean;
  reason: string | null;
}

/** Minúsculas, sem acento e sem marcações de gênero como "(a)". */
export function foldTitle(title: string): string {
  return fold(title).replace(/\((?:a|o|as|os)\)/g, '').replace(/\s+/g, ' ');
}

export function hasFrontendTerm(title: string, cfg: Filters): boolean {
  return findTerm(foldTitle(title), cfg.title.frontend_terms) !== null;
}

/** Classifica só pelo título (sem precisar da descrição). */
export function classifyTitle(title: string, cfg: Filters): TitleClass {
  const t = foldTitle(title);
  const c = cfg.title;

  const level = findTerm(t, c.cut_always.level);
  if (level) return { status: 'cut', reason: `level:${level}` };
  const stack = findTerm(t, c.cut_always.stack);
  if (stack) return { status: 'cut', reason: `stack:${stack}` };

  if (!findTerm(t, c.strong_frontend_terms)) {
    const off = findTerm(t, c.cut_unless_strong_frontend);
    if (off) return { status: 'cut', reason: `off_area:${off}` };
  }

  if (findTerm(t, c.frontend_terms)) return { status: 'pass' };
  if (findTerm(t, c.generic_titles)) return { status: 'generic' };
  return { status: 'cut', reason: 'title_not_frontend' };
}

export function titleFilter(title: string, description: string, cfg: Filters): Verdict {
  const cls = classifyTitle(title, cfg);
  if (cls.status === 'pass') return { pass: true, reason: null };
  if (cls.status === 'cut') return { pass: false, reason: cls.reason };
  const mention = findTerm(fold(description), cfg.title.generic_requires_description_terms);
  return mention ? { pass: true, reason: null } : { pass: false, reason: 'generic_without_react_ts' };
}

export function locationFilter(
  workplace: Workplace,
  location: string,
  description: string,
  cfg: Filters,
): Verdict & { region_hint: RegionHint } {
  const region_hint = regionHint(location, description, cfg.location);
  if (workplace === 'hybrid' || workplace === 'onsite') {
    return { pass: false, reason: `workplace:${workplace}`, region_hint };
  }
  if (region_hint === 'restricted') return { pass: false, reason: 'region_restricted', region_hint };
  return { pass: true, reason: null, region_hint };
}
