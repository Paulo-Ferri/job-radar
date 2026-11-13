import type { Filters, RegionHint, Workplace } from './types.js';
import { findTerm, fold } from './text.js';

type LocationCfg = Filters['location'];

// Siglas de estados dos EUA depois de vírgula ("Austin, TX"). Ficam de fora as que colidem com
// estados brasileiros (AL, MA, MS, MT, PA, SC) ou países da América Latina (AR, CO).
const US_STATE_AFTER_COMMA =
  /,\s*(AK|AZ|CA|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MD|ME|MI|MN|MO|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|RI|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?![A-Za-z])/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function allowedHint(
  text: string,
  cfg: LocationCfg,
  opts: { places: boolean; worldwide: boolean },
): Exclude<RegionHint, 'restricted' | 'unknown'> | null {
  const f = fold(text);
  if (findTerm(f, cfg.brazil_terms) || (opts.places && findTerm(f, cfg.brazil_places))) return 'brazil';
  if (findTerm(f, cfg.latam_terms) || (opts.places && findTerm(f, cfg.latam_places))) return 'latam';
  if (findTerm(f, cfg.americas_terms)) return 'americas';
  if (opts.worldwide && findTerm(f, cfg.worldwide_terms)) return 'worldwide';
  return null;
}

/** O texto do local cita país/região/cidade fora da América Latina? Devolve o termo ou null. */
export function restrictedTerm(location: string, cfg: LocationCfg): string | null {
  const hit = findTerm(fold(location), cfg.restricted_terms);
  if (hit) return hit;
  for (const t of cfg.restricted_case_sensitive) {
    if (new RegExp(`(?<![A-Za-z0-9])${escapeRe(t)}(?![A-Za-z0-9])`).test(location)) return t;
  }
  const state = US_STATE_AFTER_COMMA.exec(location);
  return state ? state[1]! : null;
}

/**
 * region_hint: primeiro pelo local (termos + cidades/países); se o local não disser nada, pela
 * descrição (só os termos gerais: Brazil, LATAM, Americas, Worldwide...).
 * Quando o local nomeia país/região fora da América Latina, só Brazil/LATAM/Americas na descrição
 * salvam a vaga: "worldwide/anywhere/global" na descrição não contam (quase toda empresa se diz
 * "global"); esses termos só valem no próprio campo de local.
 */
export function regionHint(location: string, description: string, cfg: LocationCfg): RegionHint {
  const fromLocation = allowedHint(location, cfg, { places: true, worldwide: true });
  if (fromLocation) return fromLocation;
  if (restrictedTerm(location, cfg)) {
    return allowedHint(description, cfg, { places: false, worldwide: false }) ?? 'restricted';
  }
  return allowedHint(description, cfg, { places: false, worldwide: true }) ?? 'unknown';
}

/** Para fontes que não declaram a modalidade em campo próprio: lê do texto do local. */
export function inferWorkplace(text: string): Workplace {
  const f = fold(text);
  if (/hybrid|hibrido/.test(f)) return 'hybrid';
  if (/remote|remoto|home ?office|anywhere|teletrabalho/.test(f)) return 'remote';
  if (/on-?site|presencial|in-office/.test(f)) return 'onsite';
  return 'unknown';
}
