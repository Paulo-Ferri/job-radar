import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { State, StateJob } from './types.js';
import { emptyState } from './state.js';

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

interface StateFile {
  boards: Record<string, string>;
  jobs: StateJob[];
}

export async function readState(path: string): Promise<State> {
  const file = await readJson<StateFile | null>(path, null);
  if (!file) return emptyState();
  return { boards: file.boards ?? {}, jobs: Object.fromEntries((file.jobs ?? []).map((j) => [j.id, j])) };
}

const byKey = <T>(entries: Array<[string, T]>) => entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Uma vaga por linha e ordem estável, para o diff do git só mostrar o que abriu ou fechou. */
export function serializeState(state: State): string {
  const boards = Object.fromEntries(byKey(Object.entries(state.boards)));
  const jobs = byKey(Object.entries(state.jobs)).map(([, j]) =>
    // Chaves ausentes (company/title/url das vagas cortadas pelo título) não são escritas.
    JSON.stringify({
      id: j.id,
      company: j.company,
      title: j.title,
      url: j.url,
      first_seen_at: j.first_seen_at,
      closed_at: j.closed_at,
    }),
  );
  const boardsJson = JSON.stringify(boards, null, 2).replace(/\n/g, '\n  ');
  return `{\n  "boards": ${boardsJson},\n  "jobs": [\n    ${jobs.join(',\n    ')}\n  ]\n}\n`;
}

export async function writeState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeState(state));
}
