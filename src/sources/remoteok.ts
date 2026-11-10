import type { RawJob } from '../types.js';
import { getJson } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';
import { extractAtsLinks } from '../discover.js';

interface RemoteOkJob {
  id?: string | number;
  date?: string | null;
  epoch?: number | null;
  company?: string | null;
  position?: string | null;
  location?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  apply_url?: string | null;
  url?: string | null;
  description?: string | null;
}

export function normalizeRemoteOk(payload: RemoteOkJob[]): RawJob[] {
  // O primeiro elemento é o aviso legal (não tem id nem position).
  return payload
    .filter((j) => j.id != null && j.position)
    .map((j) => ({
      id: `remoteok:${j.id}`,
      source: 'remoteok',
      board: 'remoteok',
      company: cleanText(j.company ?? ''),
      title: cleanText(j.position ?? ''),
      url: j.url ?? j.apply_url ?? '',
      location: cleanText(j.location ?? ''),
      workplace: 'remote' as const,
      published_at: toIso(j.date) ?? (j.epoch ? toIso(j.epoch * 1000) : null),
      employment_type: null,
      salary: j.salary_min || j.salary_max ? `${j.salary_min ?? 0} - ${j.salary_max ?? 0} USD` : null,
      description: htmlToText(j.description),
      ats_links: extractAtsLinks(`${j.apply_url ?? ''} ${j.description ?? ''}`),
    }));
}

export async function fetchRemoteOk(): Promise<RawJob[]> {
  return normalizeRemoteOk(await getJson<RemoteOkJob[]>('https://remoteok.com/api'));
}
