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
  withPlaces: boolean,
): Exclude<RegionHint, 'restricted' | 'unknown'> | null {
  const f = fold(text);
  if (findTerm(f, cfg.brazil_terms) || (withPlaces && findTerm(f, cfg.brazil_places))) return 'brazil';
  if (findTerm(f, cfg.latam_terms) || (withPlaces && findTerm(f, cfg.latam_places))) return 'latam';
  if (findTerm(f, cfg.americas_terms)) return 'americas';
  if (findTerm(f, cfg.worldwide_terms)) return 'worldwide';
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
 * "restricted" só quando o local é de fora da América Latina e nem local nem descrição
 * citam Brazil/LATAM/Americas/Worldwide/Anywhere/Global.
 */
export function regionHint(location: string, description: string, cfg: LocationCfg): RegionHint {
  const fromLocation = allowedHint(location, cfg, true);
  if (fromLocation) return fromLocation;
  const fromDescription = allowedHint(description, cfg, false);
  if (restrictedTerm(location, cfg)) {
    if (!fromDescription) return 'restricted';
    // Local restrito salvo só por "global/worldwide" na descrição: passa, mas sem afirmar região.
    return fromDescription === 'worldwide' ? 'unknown' : fromDescription;
  }
  return fromDescription ?? 'unknown';
}

/** Para fontes que não declaram a modalidade em campo próprio: lê do texto do local. */
export function inferWorkplace(text: string): Workplace {
  const f = fold(text);
  if (/hybrid|hibrido/.test(f)) return 'hybrid';
  if (/remote|remoto|home ?office|anywhere|teletrabalho/.test(f)) return 'remote';
  if (/on-?site|presencial|in-office/.test(f)) return 'onsite';
  return 'unknown';
}
