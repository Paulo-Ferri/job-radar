/** Resumo da última execução local: npm run summary [-- --all] */
import { readFileSync } from 'node:fs';
import type { Health, Latest } from '../src/types.js';
import type { Rejected } from '../src/pipeline.js';

const read = <T>(p: string): T => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8')) as T;
const latest = read<Latest>('latest.json');
const health = read<Health>('health.json');
const { passed_filters, rejected } = read<{ passed_filters: number; rejected: Rejected[] }>('rejected.json');
const all = process.argv.includes('--all');
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const boards = Object.entries(health.boards);
const failed = boards.filter(([, b]) => !b.ok);
console.log(`Boards ok: ${boards.length - failed.length} | com falha: ${failed.length}`);
for (const [id, b] of failed) console.log(`  ✗ ${id} (${b.error}, ${b.consecutive_failures}x)`);
const empty = boards.filter(([, b]) => b.ok && b.jobs === 0).map(([id]) => id);
if (empty.length) console.log(`  ok mas com 0 vagas: ${empty.join(', ')}`);
console.log(
  `Vagas vistas: ${latest.stats.jobs_seen} | passaram nos filtros: ${passed_filters} | na janela (${latest.window_hours}h): ${latest.stats.jobs_in_window}`,
);

console.log('\nNa janela, por fonte:');
const bySource = new Map<string, number>();
for (const j of latest.jobs) bySource.set(j.source, (bySource.get(j.source) ?? 0) + 1);
for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${s}`);

console.log(`\nAmostra de vagas na janela (${all ? 'todas' : '10'}):`);
for (const j of all ? latest.jobs : latest.jobs.slice(0, 10)) {
  console.log(
    `  ${cut(j.company, 18).padEnd(18)} | ${cut(j.title, 52).padEnd(52)} | ${cut(j.location || '-', 28).padEnd(28)} | ${(j.published_at ?? j.first_seen_at).slice(0, 16)} | ${j.date_confidence} | ${j.region_hint}`,
  );
}

console.log('\nCortes por motivo:');
const byReason = new Map<string, number>();
for (const r of rejected) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${reason}`);

const line = (r: Rejected) =>
  `  ${r.reason.padEnd(26)} | ${cut(r.company, 16).padEnd(16)} | ${cut(r.title, 58).padEnd(58)} | ${cut(r.location || '-', 30)}`;

const frontend = rejected.filter((r) => r.frontend_title);
console.log(`\nCortadas com termo de frontend no título (${frontend.length}):`);
for (const r of frontend.sort((a, b) => a.reason.localeCompare(b.reason) || a.company.localeCompare(b.company))) console.log(line(r));
