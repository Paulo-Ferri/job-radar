import { readFileSync } from 'node:fs';
import type { Filters, RawJob } from '../src/types.js';

export const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
export const jsonFixture = <T = any>(name: string): T => JSON.parse(fixture(name)) as T;
export const filters = JSON.parse(
  readFileSync(new URL('../config/filters.json', import.meta.url), 'utf8'),
) as Filters;

export function raw(over: Partial<RawJob> = {}): RawJob {
  const source = over.source ?? 'greenhouse';
  const board = over.board ?? (['himalayas', 'remoteok', 'wwr'].includes(source) ? source : `${source}:acme`);
  return {
    id: `${board}:1`,
    source,
    board,
    company: 'Acme',
    title: 'Frontend Engineer',
    url: 'https://example.com/job/1',
    location: 'Remote',
    workplace: 'remote',
    published_at: null,
    employment_type: null,
    salary: null,
    description: 'We use React and TypeScript.',
    ...over,
  };
}
