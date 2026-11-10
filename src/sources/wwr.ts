import { XMLParser } from 'fast-xml-parser';
import type { RawJob } from '../types.js';
import { getText } from '../http.js';
import { cleanText, htmlToText, toIso } from '../text.js';
import { extractAtsLinks } from '../discover.js';

export const WWR_FEEDS = [
  'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
];

interface WwrItem {
  title?: string;
  region?: string;
  country?: string;
  type?: string;
  description?: string;
  pubDate?: string;
  guid?: string;
  link?: string;
}

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function normalizeWwr(xml: string): RawJob[] {
  const parsed = parser.parse(xml) as { rss?: { channel?: { item?: WwrItem | WwrItem[] } } };
  const raw = parsed.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items
    .filter((it) => str(it.guid) || str(it.link))
    .map((it) => {
      // O título vem como "Empresa: Cargo".
      const full = cleanText(str(it.title));
      const sep = full.indexOf(': ');
      const url = str(it.link) || str(it.guid);
      const description = str(it.description);
      const places = [cleanText(str(it.region)), cleanText(str(it.country))].filter(Boolean);
      return {
        id: `wwr:${(str(it.guid) || url).replace(/^https?:\/\/[^/]+\/remote-jobs\//, '')}`,
        source: 'wwr',
        board: 'wwr',
        company: sep > 0 ? full.slice(0, sep) : '',
        title: sep > 0 ? full.slice(sep + 2) : full,
        url,
        location: [...new Set(places)].join(', '),
        workplace: 'remote' as const,
        published_at: toIso(str(it.pubDate)),
        employment_type: cleanText(str(it.type)) || null,
        salary: null,
        description: htmlToText(description),
        ats_links: extractAtsLinks(description),
      };
    });
}

export async function fetchWwr(): Promise<RawJob[]> {
  const feeds = await Promise.all(WWR_FEEDS.map((u) => getText(u, 'application/rss+xml, application/xml')));
  const byId = new Map<string, RawJob>();
  for (const xml of feeds) for (const job of normalizeWwr(xml)) byId.set(job.id, job);
  return [...byId.values()];
}
