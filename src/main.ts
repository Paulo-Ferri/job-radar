import { fileURLToPath } from 'node:url';
import type { BoardResult, Company, Discovered, Filters, Health, RawJob } from './types.js';
import { errorCode } from './http.js';
import { classifyTitle, workplaceCut } from './filters.js';
import { runPipeline } from './pipeline.js';
import { updateDiscovered } from './discover.js';
import { readJson, readState, writeJson, writeState } from './output.js';
import { fetchGreenhouse } from './sources/greenhouse.js';
import { fetchAshby } from './sources/ashby.js';
import { fetchLever } from './sources/lever.js';
import { fetchWorkable } from './sources/workable.js';
import { fetchSmartRecruiters } from './sources/smartrecruiters.js';
import { fetchRecruitee } from './sources/recruitee.js';
import { fetchInhire } from './sources/inhire.js';
import { fetchHimalayas } from './sources/himalayas.js';
import { fetchRemoteOk } from './sources/remoteok.js';
import { fetchWwr } from './sources/wwr.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = (p: string) => `${root}${p}`;

async function collect(board: string, name: string, fn: () => Promise<RawJob[]>): Promise<BoardResult> {
  try {
    return { board, name, ok: true, jobs: await fn(), error: null };
  } catch (e) {
    return { board, name, ok: false, jobs: [], error: errorCode(e) };
  }
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const companies = await readJson<Company[]>(path('config/companies.json'), []);
  const filters = await readJson<Filters | null>(path('config/filters.json'), null);
  if (!filters) throw new Error('config/filters.json não encontrado');
  const prevState = await readState(path('data/state.json'));
  const prevHealth = await readJson<Health | null>(path('data/health.json'), null);
  const prevDiscovered = await readJson<Discovered[]>(path('data/discovered.json'), []);

  const cutoff = Date.parse(now) - filters.window_hours * 3_600_000;
  const wantsDetail = (title: string) => classifyTitle(title, filters).status !== 'cut';

  const fetchers: Record<Company['ats'], (c: Company) => Promise<RawJob[]>> = {
    greenhouse: fetchGreenhouse,
    ashby: fetchAshby,
    lever: fetchLever,
    workable: fetchWorkable,
    smartrecruiters: (c) => fetchSmartRecruiters(c, wantsDetail),
    recruitee: fetchRecruitee,
    inhire: (c) =>
      fetchInhire(c, (title, workplace, location) => wantsDetail(title) && workplaceCut(workplace, location, filters) === null),
  };

  const tasks: Array<Promise<BoardResult>> = companies.map((c) => {
    const fetcher = fetchers[c.ats];
    const board = `${c.ats}:${c.id}`;
    if (!fetcher) return Promise.resolve({ board, name: c.name, ok: false, jobs: [], error: 'unsupported_ats' });
    return collect(board, c.name, () => fetcher(c));
  });
  tasks.push(
    collect('himalayas', 'Himalayas', () => fetchHimalayas(filters.himalayas, cutoff)),
    collect('remoteok', 'RemoteOK', fetchRemoteOk),
    collect('wwr', 'We Work Remotely', fetchWwr),
  );
  const results = await Promise.all(tasks);

  const out = runPipeline({ results, prevState, prevHealth, filters, now });
  const discovered = updateDiscovered(prevDiscovered, out.allJobs, companies, now);

  await writeJson(path('data/latest.json'), out.latest);
  await writeState(path('data/state.json'), out.state);
  await writeJson(path('data/health.json'), out.health);
  await writeJson(path('data/discovered.json'), discovered);
  // Arquivo local (fora do git) para auditar os cortes.
  await writeJson(path('data/rejected.json'), {
    generated_at: now,
    passed_filters: out.passed.length,
    rejected: out.rejected,
  });

  const { stats } = out.latest;
  console.log(
    `boards ok=${stats.boards_ok} falha=${stats.boards_failed} | vagas vistas=${stats.jobs_seen} ` +
      `passaram nos filtros=${out.passed.length} na janela=${stats.jobs_in_window}`,
  );
  for (const r of results.filter((r) => !r.ok)) console.log(`  falhou: ${r.board} (${r.error})`);

  if (results.length > 0 && stats.boards_ok === 0) {
    console.error('Todas as fontes falharam.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
