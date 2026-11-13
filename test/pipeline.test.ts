import { describe, expect, it } from 'vitest';
import { filters, raw } from './helpers.js';
import { dedupe, mergeLocations } from '../src/dedup.js';
import { boardOfId, emptyState, isNew, updateState } from '../src/state.js';
import { runPipeline } from '../src/pipeline.js';
import { serializeState } from '../src/output.js';
import { updateDiscovered } from '../src/discover.js';
import type { BoardResult, RawJob, State } from '../src/types.js';

const NOW = '2026-11-09T10:17:00.000Z';
const hoursAgo = (h: number, from = NOW) => new Date(Date.parse(from) - h * 3_600_000).toISOString();
const daysAgo = (d: number, from = NOW) => hoursAgo(d * 24, from);
const ok = (board: string, jobs: RawJob[]): BoardResult => ({ board, name: board, ok: true, jobs, error: null });
const failed = (board: string): BoardResult => ({ board, name: board, ok: false, jobs: [], error: 'http_500' });
const run = (results: BoardResult[], prevState: State = emptyState(), now = NOW) =>
  runPipeline({ results, prevState, prevHealth: null, filters, now });

describe('deduplicação', () => {
  it('mesma fonte: pelo id', () => {
    const a = raw({ source: 'himalayas', id: 'himalayas:acme/fe' });
    expect(dedupe([a, { ...a }])).toHaveLength(1);
  });

  it('entre fontes: ATS vence agregador com mesma empresa + título', () => {
    const ats = raw({ id: 'greenhouse:acme:1', company: 'Acme, Inc.', title: 'Senior Front-End Engineer' });
    const agg = raw({ source: 'himalayas', id: 'himalayas:acme/x', company: 'ACME', title: 'Senior Front‑End  Engineer' });
    expect(dedupe([agg, ats]).map((g) => g.map((j) => j.id))).toEqual([['greenhouse:acme:1']]);
  });

  it('entre agregadores fica só uma; títulos diferentes ficam', () => {
    const a = raw({ source: 'himalayas', id: 'himalayas:acme/fe' });
    const b = raw({ source: 'remoteok', id: 'remoteok:9' });
    const c = raw({ source: 'wwr', id: 'wwr:acme-react', title: 'React Engineer' });
    expect(dedupe([a, b, c]).map((g) => g.map((j) => j.id))).toEqual([['himalayas:acme/fe'], ['wwr:acme-react']]);
  });

  it('mesma fonte: mesma empresa + mesmo título em locais diferentes formam um grupo', () => {
    const a = raw({ source: 'recruitee', id: 'recruitee:acme:1', location: 'Brazil' });
    const b = raw({ source: 'recruitee', id: 'recruitee:acme:2', location: 'Mexico', title: 'Frontend  engineer' });
    const c = raw({ source: 'recruitee', id: 'recruitee:acme:3', title: 'React Engineer' });
    const other = raw({ source: 'recruitee', board: 'recruitee:beta', id: 'recruitee:beta:1', company: 'Beta' });
    expect(dedupe([a, b, c, other]).map((g) => g.map((j) => j.id))).toEqual([
      ['recruitee:acme:1', 'recruitee:acme:2'],
      ['recruitee:acme:3'],
      ['recruitee:beta:1'],
    ]);
  });

  it('junta locais sem repetir', () => {
    expect(mergeLocations(['Remote, US; Brazil', 'brazil', '', 'Mexico'])).toBe('Remote, US; Brazil; Mexico');
  });
});

describe('regra de vaga nova', () => {
  const cutoff = Date.parse(hoursAgo(72));

  it('published_at dentro da janela é nova, com ou sem linha de base', () => {
    expect(isNew({ published_at: hoursAgo(10), first_seen_at: NOW }, NOW, cutoff)).toBe(true);
    expect(isNew({ published_at: hoursAgo(10), first_seen_at: NOW }, null, cutoff)).toBe(true);
    expect(isNew({ published_at: hoursAgo(10), first_seen_at: daysAgo(30) }, daysAgo(60), cutoff)).toBe(true);
  });

  it('primeira coleta do board: first_seen_at não conta, com ou sem data de fonte', () => {
    expect(isNew({ published_at: null, first_seen_at: NOW }, NOW, cutoff)).toBe(false);
    expect(isNew({ published_at: daysAgo(30), first_seen_at: NOW }, NOW, cutoff)).toBe(false);
    // Nem nos dias seguintes: quem entrou na linha de base não vira novidade depois.
    expect(isNew({ published_at: null, first_seen_at: hoursAgo(24) }, hoursAgo(24), cutoff)).toBe(false);
  });

  it('board com linha de base: first_seen_at na janela conta mesmo com data de fonte antiga (Lever)', () => {
    expect(isNew({ published_at: daysAgo(30), first_seen_at: hoursAgo(1) }, daysAgo(10), cutoff)).toBe(true);
    expect(isNew({ published_at: null, first_seen_at: hoursAgo(1) }, daysAgo(10), cutoff)).toBe(true);
    expect(isNew({ published_at: daysAgo(30), first_seen_at: hoursAgo(73) }, daysAgo(10), cutoff)).toBe(false);
  });
});

describe('estado', () => {
  it('identifica o board pelo id', () => {
    expect(boardOfId('greenhouse:gitlab:123')).toBe('greenhouse:gitlab');
    expect(boardOfId('ashby:kraken.com:abc')).toBe('ashby:kraken.com');
    expect(boardOfId('himalayas:acme/fe')).toBe('himalayas');
  });

  it('fecha só quando a consulta do board deu certo e a vaga não veio', () => {
    const a = raw({ id: 'greenhouse:acme:1' });
    const b = raw({ id: 'greenhouse:acme:2' });
    const day1 = updateState(emptyState(), ['greenhouse:acme'], [a, b], daysAgo(2)).state;
    expect(day1.jobs['greenhouse:acme:1']).toMatchObject({ first_seen_at: daysAgo(2), closed_at: null });

    const boardFailed = updateState(day1, [], [], daysAgo(1)).state;
    expect(boardFailed.jobs['greenhouse:acme:2']!.closed_at).toBeNull();

    const day3 = updateState(boardFailed, ['greenhouse:acme'], [a], NOW).state;
    expect(day3.jobs['greenhouse:acme:1']!.closed_at).toBeNull();
    expect(day3.jobs['greenhouse:acme:2']).toMatchObject({ first_seen_at: daysAgo(2), closed_at: NOW });
  });

  it('reabre a vaga que reaparece, preservando first_seen_at', () => {
    const a = raw({ id: 'greenhouse:acme:1' });
    const s1 = updateState(emptyState(), ['greenhouse:acme'], [a], daysAgo(5)).state;
    const s2 = updateState(s1, ['greenhouse:acme'], [], daysAgo(4)).state;
    expect(s2.jobs[a.id]!.closed_at).toBe(daysAgo(4));
    const s3 = updateState(s2, ['greenhouse:acme'], [a], NOW).state;
    expect(s3.jobs[a.id]).toMatchObject({ first_seen_at: daysAgo(5), closed_at: null });
  });

  it('remove vagas fechadas há mais de 90 dias e mantém as abertas antigas', () => {
    const prev: State = {
      boards: { 'greenhouse:acme': daysAgo(200) },
      jobs: {
        old: { id: 'old', company: 'A', title: 'T', url: 'u', first_seen_at: daysAgo(200), closed_at: daysAgo(91) },
        recent: { id: 'recent', company: 'A', title: 'T', url: 'u', first_seen_at: daysAgo(200), closed_at: daysAgo(89) },
      },
    };
    const open = raw({ id: 'greenhouse:acme:1' });
    const s0 = updateState(emptyState(), ['greenhouse:acme'], [open], daysAgo(200)).state;
    const next = updateState({ boards: prev.boards, jobs: { ...prev.jobs, ...s0.jobs } }, ['greenhouse:acme'], [open], NOW).state;
    expect(Object.keys(next.jobs).sort()).toEqual(['greenhouse:acme:1', 'recent']);
  });

  it('não muda o arquivo quando nada abre nem fecha', () => {
    const a = raw({ id: 'greenhouse:acme:1' });
    const s1 = updateState(emptyState(), ['greenhouse:acme'], [a], daysAgo(1)).state;
    const s2 = updateState(s1, ['greenhouse:acme'], [a], NOW).state;
    expect(serializeState(s2)).toBe(serializeState(s1));
    expect(JSON.parse(serializeState(s2)).jobs[0]).toEqual({
      id: a.id,
      company: 'Acme',
      title: 'Frontend Engineer',
      url: a.url,
      first_seen_at: daysAgo(1),
      closed_at: null,
    });
  });

  it('vaga que não passa no filtro de título fica só com id e datas', () => {
    const keep = (title: string) => title !== 'Account Executive';
    const fe = raw({ id: 'greenhouse:acme:1' });
    const ae = raw({ id: 'greenhouse:acme:2', title: 'Account Executive' });
    const s1 = updateState(emptyState(), ['greenhouse:acme'], [fe, ae], daysAgo(1), keep).state;
    expect(s1.jobs[fe.id]).toEqual({ id: fe.id, company: 'Acme', title: 'Frontend Engineer', url: fe.url, first_seen_at: daysAgo(1), closed_at: null });
    expect(s1.jobs[ae.id]).toEqual({ id: ae.id, first_seen_at: daysAgo(1), closed_at: null });
    expect(JSON.parse(serializeState(s1)).jobs[1]).toEqual({ id: ae.id, first_seen_at: daysAgo(1), closed_at: null });

    // Fecha e reabre normalmente, preservando first_seen_at.
    const s2 = updateState(s1, ['greenhouse:acme'], [fe], NOW, keep).state;
    expect(s2.jobs[ae.id]).toEqual({ id: ae.id, first_seen_at: daysAgo(1), closed_at: NOW });
    expect(updateState(s2, ['greenhouse:acme'], [fe, ae], NOW, keep).state.jobs[ae.id]).toEqual({ id: ae.id, first_seen_at: daysAgo(1), closed_at: null });
  });

  it('fechadas que não passam no título saem em 14 dias; as que passam, em 90', () => {
    const prev: State = {
      boards: { 'greenhouse:acme': daysAgo(200) },
      jobs: {
        slim15: { id: 'slim15', first_seen_at: daysAgo(200), closed_at: daysAgo(15) },
        slim13: { id: 'slim13', first_seen_at: daysAgo(200), closed_at: daysAgo(13) },
        slimOpen: { id: 'slimOpen', first_seen_at: daysAgo(200), closed_at: null },
        full15: { id: 'full15', company: 'A', title: 'Frontend Engineer', url: 'u', first_seen_at: daysAgo(200), closed_at: daysAgo(15) },
        full91: { id: 'full91', company: 'A', title: 'Frontend Engineer', url: 'u', first_seen_at: daysAgo(200), closed_at: daysAgo(91) },
        // Formato antigo, título cortado: vira enxuta e já entra na regra dos 14 dias.
        old15: { id: 'old15', company: 'A', title: 'Account Executive', url: 'u', first_seen_at: daysAgo(200), closed_at: daysAgo(15) },
      },
    };
    const out = run([], prev);
    expect(Object.keys(out.state.jobs).sort()).toEqual(['full15', 'slim13', 'slimOpen']);
  });

  it('entradas completas do formato antigo perdem os detalhes quando o título não passa', () => {
    const prev: State = {
      boards: { 'greenhouse:acme': daysAgo(9), 'lever:down': daysAgo(9) },
      jobs: {
        'greenhouse:acme:9': { id: 'greenhouse:acme:9', company: 'Acme', title: 'Account Executive', url: 'u', first_seen_at: daysAgo(9), closed_at: daysAgo(2) },
        'lever:down:1': { id: 'lever:down:1', company: 'Down', title: 'Staff Engineer', url: 'u', first_seen_at: daysAgo(9), closed_at: null },
        'lever:down:2': { id: 'lever:down:2', company: 'Down', title: 'Frontend Engineer', url: 'u', first_seen_at: daysAgo(9), closed_at: null },
      },
    };
    const out = run([ok('greenhouse:acme', []), failed('lever:down')], prev);
    expect(out.state.jobs['greenhouse:acme:9']).toEqual({ id: 'greenhouse:acme:9', first_seen_at: daysAgo(9), closed_at: daysAgo(2) });
    expect(out.state.jobs['lever:down:1']).toEqual({ id: 'lever:down:1', first_seen_at: daysAgo(9), closed_at: null });
    expect(out.state.jobs['lever:down:2']).toMatchObject({ title: 'Frontend Engineer', closed_at: null });
  });

  it('pipeline: o estado só guarda detalhes de quem passa no filtro de título', () => {
    const out = run([
      ok('greenhouse:acme', [
        raw({ id: 'greenhouse:acme:1' }),
        raw({ id: 'greenhouse:acme:2', title: 'Software Engineer', description: 'Go and Kubernetes' }),
        raw({ id: 'greenhouse:acme:3', title: 'Software Engineer', description: 'React' }),
        raw({ id: 'greenhouse:acme:4', location: 'Remote, US' }),
      ]),
    ]);
    expect(Object.values(out.state.jobs).map((j) => [j.id, j.title])).toEqual([
      ['greenhouse:acme:1', 'Frontend Engineer'],
      ['greenhouse:acme:2', undefined],
      ['greenhouse:acme:3', 'Software Engineer'],
      // Cortada só pelo local: o título passa, então os detalhes ficam.
      ['greenhouse:acme:4', 'Frontend Engineer'],
    ]);
  });

  it('guarda o momento da linha de base de cada board e não o sobrescreve', () => {
    const first = updateState(emptyState(), ['greenhouse:acme'], [], daysAgo(1));
    const second = updateState(first.state, ['greenhouse:acme', 'lever:new'], [], NOW);
    expect(updateState(second.state, [], [], NOW).state.boards).toEqual(second.state.boards);
    expect(second.state.boards).toEqual({ 'greenhouse:acme': daysAgo(1), 'lever:new': NOW });
  });
});

describe('pipeline', () => {
  it('primeira execução: só entra o que tem published_at na janela', () => {
    const jobs = [
      raw({ id: 'greenhouse:acme:1', published_at: hoursAgo(5) }),
      raw({ id: 'greenhouse:acme:2', title: 'React Engineer', published_at: daysAgo(30) }),
      raw({ id: 'greenhouse:acme:3', title: 'UI Engineer', published_at: null }),
    ];
    const out = run([ok('greenhouse:acme', jobs)]);
    expect(out.latest.jobs.map((j) => j.id)).toEqual(['greenhouse:acme:1']);
    expect(out.passed).toHaveLength(3);
    expect(Object.keys(out.state.jobs)).toHaveLength(3);
    expect(out.latest.stats).toEqual({ boards_ok: 1, boards_failed: 0, jobs_seen: 3, jobs_in_window: 1 });
  });

  it('execução seguinte: vaga inédita entra por first_seen_at, com ou sem data de fonte', () => {
    const old = raw({ id: 'lever:acme:1', source: 'lever', published_at: daysAgo(30) });
    const day1 = run([ok('lever:acme', [old])], emptyState(), daysAgo(1));
    expect(day1.latest.jobs).toHaveLength(0);

    const lateLever = raw({ id: 'lever:acme:2', source: 'lever', title: 'React Engineer', published_at: daysAgo(40) });
    const noDate = raw({ id: 'lever:acme:3', source: 'lever', title: 'UI Engineer', published_at: null });
    const day2 = run([ok('lever:acme', [old, lateLever, noDate])], day1.state);
    expect(day2.latest.jobs.map((j) => j.id).sort()).toEqual(['lever:acme:2', 'lever:acme:3']);
    const byId = Object.fromEntries(day2.latest.jobs.map((j) => [j.id, j]));
    expect(byId['lever:acme:2']).toMatchObject({ published_at: daysAgo(40), first_seen_at: NOW, date_confidence: 'ats' });
    expect(byId['lever:acme:3']).toMatchObject({ published_at: null, first_seen_at: NOW, date_confidence: 'first_seen' });

    // Depois da janela, saem.
    const day6 = run([ok('lever:acme', [old, lateLever, noDate])], day2.state, new Date(Date.parse(NOW) + 96 * 3_600_000).toISOString());
    expect(day6.latest.jobs).toHaveLength(0);
  });

  it('empresa nova em companies.json não despeja o board inteiro', () => {
    const day1 = run([ok('greenhouse:acme', [raw({ id: 'greenhouse:acme:1' })])], emptyState(), daysAgo(1));
    const fresh = [1, 2, 3].map((n) => raw({ source: 'ashby', board: 'ashby:new', id: `ashby:new:${n}`, title: `Frontend Engineer ${n}` }));
    const day2 = run([ok('greenhouse:acme', [raw({ id: 'greenhouse:acme:1' })]), ok('ashby:new', fresh)], day1.state);
    expect(day2.latest.jobs).toHaveLength(0);
    expect(Object.keys(day2.state.jobs)).toHaveLength(4);
  });

  it('board que falha não derruba a execução nem fecha vagas', () => {
    const a = raw({ id: 'greenhouse:acme:1', published_at: hoursAgo(1) });
    const day1 = run([ok('greenhouse:acme', [a]), ok('wwr', [])], emptyState(), daysAgo(1));
    const day2 = run([failed('greenhouse:acme'), ok('wwr', [])], day1.state);
    expect(day2.state.jobs[a.id]!.closed_at).toBeNull();
    expect(day2.latest.stats).toMatchObject({ boards_ok: 1, boards_failed: 1 });
    expect(day2.health.boards['greenhouse:acme']).toMatchObject({ ok: false, error: 'http_500', consecutive_failures: 1, last_ok_at: null });

    const day3 = runPipeline({ results: [failed('greenhouse:acme')], prevState: day2.state, prevHealth: day2.health, filters, now: NOW });
    expect(day3.health.boards['greenhouse:acme']!.consecutive_failures).toBe(2);
    const day4 = runPipeline({ results: [ok('greenhouse:acme', [a])], prevState: day3.state, prevHealth: day3.health, filters, now: NOW });
    expect(day4.health.boards['greenhouse:acme']).toMatchObject({ ok: true, jobs: 1, error: null, consecutive_failures: 0, last_ok_at: NOW });
  });

  it('ordena da mais recente para a mais antiga e segue o contrato', () => {
    const jobs = [
      raw({ id: 'greenhouse:acme:1', published_at: hoursAgo(50) }),
      raw({ id: 'greenhouse:acme:2', title: 'React Engineer', published_at: hoursAgo(2) }),
      raw({ id: 'greenhouse:acme:3', title: 'UI Engineer', published_at: hoursAgo(20), description: `5+ years of React. ${'x'.repeat(7000)}` }),
    ];
    const out = run([ok('greenhouse:acme', jobs)]);
    expect(out.latest.jobs.map((j) => j.id)).toEqual(['greenhouse:acme:2', 'greenhouse:acme:3', 'greenhouse:acme:1']);
    const job = out.latest.jobs[1]!;
    expect(Object.keys(job)).toEqual([
      'id', 'source', 'company', 'title', 'url', 'location', 'workplace', 'region_hint', 'published_at',
      'first_seen_at', 'date_confidence', 'employment_type', 'salary', 'hints', 'description',
    ]);
    expect(job.description).toHaveLength(6000);
    expect(job.hints).toEqual({ years: [5], mentions_react: true, mentions_typescript: false });
    expect(Object.keys(out.latest)).toEqual(['generated_at', 'window_hours', 'stats', 'jobs']);
    expect(out.latest.window_hours).toBe(72);
  });

  it('agregador usa date_confidence "feed" e registra os cortes com motivo', () => {
    const out = run([
      ok('himalayas', [
        raw({ source: 'himalayas', id: 'himalayas:a/1', published_at: hoursAgo(3) }),
        raw({ source: 'himalayas', id: 'himalayas:a/2', title: 'Staff Frontend Engineer', published_at: hoursAgo(3) }),
        raw({ source: 'himalayas', id: 'himalayas:a/3', title: 'React Engineer', location: 'United States', published_at: hoursAgo(3) }),
      ]),
    ]);
    expect(out.latest.jobs.map((j) => [j.id, j.date_confidence])).toEqual([['himalayas:a/1', 'feed']]);
    expect(out.rejected.map((r) => [r.id, r.reason, r.frontend_title])).toEqual([
      ['himalayas:a/2', 'level:staff', true],
      ['himalayas:a/3', 'region_restricted', true],
    ]);
  });
});

describe('pipeline: mesma vaga em vários locais', () => {
  const us = raw({ id: 'greenhouse:acme:1', location: 'Remote, US', published_at: hoursAgo(5) });
  const br = raw({ id: 'greenhouse:acme:2', location: 'Remote, Brazil', published_at: hoursAgo(30) });
  const mx = raw({ id: 'greenhouse:acme:3', location: 'Remote, Mexico', published_at: daysAgo(30) });
  const sp = raw({ id: 'greenhouse:acme:4', location: 'São Paulo', workplace: 'onsite', published_at: hoursAgo(1) });

  it('vira uma vaga só, com os locais concatenados e o anúncio que passa como representante', () => {
    const out = run([ok('greenhouse:acme', [us, br, mx, sp])]);
    expect(out.latest.stats).toMatchObject({ jobs_seen: 1, jobs_in_window: 1 });
    expect(out.rejected).toHaveLength(0);
    expect(out.latest.jobs[0]).toMatchObject({
      id: 'greenhouse:acme:2',
      location: 'Remote, Brazil; Remote, Mexico; Remote, US; São Paulo',
      workplace: 'remote',
      region_hint: 'brazil',
      published_at: hoursAgo(30),
    });
    // O estado continua registrando cada anúncio.
    expect(Object.keys(out.state.jobs)).toHaveLength(4);
  });

  it('se nenhum local passa, é um corte só', () => {
    const out = run([ok('greenhouse:acme', [us, sp])]);
    expect(out.passed).toHaveLength(0);
    expect(out.rejected).toEqual([
      expect.objectContaining({ id: us.id, reason: 'region_restricted', location: 'Remote, US; São Paulo' }),
    ]);
  });

  it('local novo de uma vaga antiga entra na janela', () => {
    const day1 = run([ok('greenhouse:acme', [mx])], emptyState(), daysAgo(1));
    expect(day1.latest.jobs).toHaveLength(0);
    const co = raw({ id: 'greenhouse:acme:5', location: 'Remote, Colombia', published_at: null });
    const day2 = run([ok('greenhouse:acme', [mx, co])], day1.state);
    expect(day2.latest.jobs.map((j) => [j.id, j.location])).toEqual([[co.id, 'Remote, Colombia; Remote, Mexico']]);
  });
});

describe('descoberta de ATS', () => {
  it('registra boards desconhecidos uma única vez e ignora os já configurados', () => {
    const jobs = [
      raw({ source: 'wwr', id: 'wwr:1', company: 'NewCo', ats_links: [{ ats: 'lever', id: 'newco' }] }),
      raw({ source: 'wwr', id: 'wwr:2', company: 'GitLab', ats_links: [{ ats: 'greenhouse', id: 'gitlab' }] }),
    ];
    const companies = [{ name: 'GitLab', ats: 'greenhouse', id: 'gitlab' } as const];
    const first = updateDiscovered([], jobs, [...companies], daysAgo(1));
    expect(first).toEqual([{ name: 'NewCo', ats: 'lever', id: 'newco', first_seen_at: daysAgo(1) }]);
    expect(updateDiscovered(first, jobs, [...companies], NOW)).toEqual(first);
  });
});
