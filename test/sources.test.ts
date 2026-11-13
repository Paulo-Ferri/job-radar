import { describe, expect, it } from 'vitest';
import { fixture, jsonFixture } from './helpers.js';
import { normalizeGreenhouse } from '../src/sources/greenhouse.js';
import { normalizeAshby } from '../src/sources/ashby.js';
import { normalizeLever } from '../src/sources/lever.js';
import { normalizeWorkable } from '../src/sources/workable.js';
import { describeSmartRecruiters, normalizeSmartRecruiters } from '../src/sources/smartrecruiters.js';
import { expandCountry, normalizeInhire } from '../src/sources/inhire.js';
import { normalizeRecruitee } from '../src/sources/recruitee.js';
import { normalizeHimalayas } from '../src/sources/himalayas.js';
import { normalizeRemoteOk } from '../src/sources/remoteok.js';
import { normalizeWwr } from '../src/sources/wwr.js';
import type { RawJob } from '../src/types.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function expectWellFormed(jobs: RawJob[], source: string) {
  expect(jobs.length).toBeGreaterThan(0);
  for (const j of jobs) {
    expect(j.source).toBe(source);
    expect(j.id.startsWith(`${source}:`)).toBe(true);
    expect(j.title).not.toBe('');
    expect(j.company).not.toBe('');
    expect(j.url).toMatch(/^https?:\/\//);
    expect(j.published_at).toMatch(ISO);
    expect(j.description).not.toMatch(/<\/?(p|div|li|ul|strong|br)\b/i);
    expect(j.description).not.toMatch(/&(lt|gt|amp|nbsp);/);
  }
}

describe('greenhouse', () => {
  const payload = jsonFixture('greenhouse.json');
  const jobs = normalizeGreenhouse(payload, { name: 'GitLab', ats: 'greenhouse', id: 'gitlab' });

  it('normaliza a fixture real', () => {
    expectWellFormed(jobs, 'greenhouse');
    expect(jobs).toHaveLength(payload.jobs.length);
    expect(jobs[0]!.id).toBe(`greenhouse:gitlab:${payload.jobs[0].id}`);
    expect(jobs[0]!.board).toBe('greenhouse:gitlab');
    expect(jobs[0]!.url).toBe(payload.jobs[0].absolute_url);
    expect(jobs[0]!.location).toBe(payload.jobs[0].location.name);
    expect(jobs[0]!.description.length).toBeGreaterThan(100);
  });

  it('usa first_published e nunca updated_at', () => {
    const src = payload.jobs[0];
    expect(src.first_published).not.toBe(src.updated_at);
    expect(jobs[0]!.published_at).toBe(new Date(src.first_published).toISOString());
  });

  it('fica sem data quando first_published não vem', () => {
    const [job] = normalizeGreenhouse(
      { jobs: [{ ...payload.jobs[0], first_published: null }] },
      { name: 'GitLab', ats: 'greenhouse', id: 'gitlab' },
    );
    expect(job!.published_at).toBeNull();
  });
});

describe('ashby', () => {
  const payload = jsonFixture('ashby.json');
  const company = { name: 'Kraken', ats: 'ashby', id: 'kraken.com' } as const;
  const jobs = normalizeAshby(payload, company);

  it('normaliza a fixture real', () => {
    expectWellFormed(jobs, 'ashby');
    const src = payload.jobs[0];
    expect(jobs[0]!.id).toBe(`ashby:kraken.com:${src.id}`);
    expect(jobs[0]!.url).toBe(src.jobUrl);
    expect(jobs[0]!.published_at).toBe(new Date(src.publishedAt).toISOString());
    expect(jobs[0]!.workplace).toBe('remote');
    expect(jobs[0]!.location).toContain(src.location);
    expect(jobs[0]!.location).toContain(src.secondaryLocations[0].location);
    expect(jobs[0]!.employment_type).toBe(src.employmentType);
  });

  it('exclui vagas com isListed false', () => {
    const hidden = { ...payload.jobs[0], id: 'hidden', isListed: false };
    const out = normalizeAshby({ jobs: [hidden, payload.jobs[1]] }, company);
    expect(out.map((j) => j.id)).toEqual([`ashby:kraken.com:${payload.jobs[1].id}`]);
  });

  it('mapeia workplaceType', () => {
    const base = payload.jobs[0];
    const wp = (over: object) => normalizeAshby({ jobs: [{ ...base, ...over }] }, company)[0]!.workplace;
    expect(wp({ workplaceType: 'Hybrid', isRemote: false })).toBe('hybrid');
    expect(wp({ workplaceType: 'OnSite', isRemote: false })).toBe('onsite');
    expect(wp({ workplaceType: null, isRemote: true })).toBe('remote');
    expect(wp({ workplaceType: null, isRemote: false })).toBe('unknown');
  });
});

describe('lever', () => {
  const payload = jsonFixture('lever.json');
  const jobs = normalizeLever(payload, { name: 'CI&T', ats: 'lever', id: 'ciandt' });

  it('normaliza a fixture real', () => {
    expectWellFormed(jobs, 'lever');
    const src = payload[0];
    expect(jobs[0]!.id).toBe(`lever:ciandt:${src.id}`);
    expect(jobs[0]!.url).toBe(src.hostedUrl);
    expect(jobs[0]!.published_at).toBe(new Date(src.createdAt).toISOString());
    expect(jobs[0]!.location).toBe(src.categories.allLocations.join('; '));
    expect(jobs[0]!.workplace).toBe('remote');
    expect(jobs[0]!.employment_type).toBe(src.categories.commitment);
  });
});

describe('workable', () => {
  const payload = jsonFixture('workable.json');
  const jobs = normalizeWorkable(payload, { name: 'Mindera', ats: 'workable', id: 'minderacraft' });

  it('normaliza a fixture real', () => {
    expectWellFormed(jobs, 'workable');
    const src = payload.jobs[0];
    expect(jobs[0]!.id).toBe(`workable:minderacraft:${src.shortcode}`);
    expect(jobs[0]!.url).toBe(src.url);
    expect(jobs[0]!.published_at).toBe(`${src.published_on}T00:00:00.000Z`);
    expect(jobs[0]!.location).toContain(src.country);
    expect(jobs[0]!.workplace).toBe(src.telecommuting ? 'remote' : 'unknown');
  });
});

describe('smartrecruiters', () => {
  const payload = jsonFixture('smartrecruiters.json');
  const detail = jsonFixture('smartrecruiters-detail.json');
  const company = { name: 'PSI CRO', ats: 'smartrecruiters', id: 'psicro' } as const;

  it('normaliza a listagem real com o detalhe da primeira vaga', () => {
    const src = payload.content[0];
    const jobs = normalizeSmartRecruiters(payload, company, { [src.id]: detail });
    expect(jobs).toHaveLength(payload.content.length);
    expect(jobs[0]!.id).toBe(`smartrecruiters:psicro:${src.id}`);
    expect(jobs[0]!.published_at).toBe(new Date(src.releasedDate).toISOString());
    expect(jobs[0]!.url).toBe(detail.postingUrl);
    expect(jobs[0]!.location).toBe(src.location.fullLocation);
    expect(jobs[0]!.description.length).toBeGreaterThan(100);
    expect(jobs[0]!.description).not.toMatch(/<p>/);
    // Sem detalhe: descrição vazia e URL montada.
    expect(jobs[1]!.description).toBe('');
    expect(jobs[1]!.url).toMatch(/^https:\/\/jobs\.smartrecruiters\.com\/.+\/\d+$/);
  });

  it('mapeia remote/hybrid/presencial', () => {
    const wp = (location: object) =>
      normalizeSmartRecruiters({ content: [{ ...payload.content[0], location }] }, company)[0]!.workplace;
    expect(wp({ remote: true, hybrid: false })).toBe('remote');
    expect(wp({ remote: false, hybrid: true })).toBe('hybrid');
    expect(wp({ remote: false, hybrid: false })).toBe('onsite');
    expect(wp({})).toBe('unknown');
  });

  it('junta as seções do anúncio', () => {
    expect(describeSmartRecruiters(detail)).toContain('Full-Stack Developer');
  });
});

describe('recruitee', () => {
  const payload = jsonFixture('recruitee.json');
  const jobs = normalizeRecruitee(payload, { name: 'Tether', ats: 'recruitee', id: 'tether' });

  it('normaliza a fixture real', () => {
    expectWellFormed(jobs, 'recruitee');
    const src = payload.offers[0];
    expect(jobs[0]!.id).toBe(`recruitee:tether:${src.id}`);
    expect(jobs[0]!.url).toBe(src.careers_url);
    expect(jobs[0]!.published_at).toBe(src.published_at.replace(' ', 'T').replace(' UTC', '.000Z'));
    expect(jobs[0]!.location).toContain(src.locations[0].name.trim());
    expect(jobs[0]!.workplace).toBe('remote');
  });
});

describe('himalayas', () => {
  const payload = jsonFixture('himalayas.json');
  const jobs = normalizeHimalayas(payload);

  it('normaliza a fixture real (pubDate em segundos)', () => {
    expectWellFormed(jobs, 'himalayas');
    const src = payload.jobs[0];
    expect(jobs[0]!.board).toBe('himalayas');
    expect(jobs[0]!.id).toBe(`himalayas:${src.companySlug}/${src.guid.split('/jobs/')[1]}`);
    expect(jobs[0]!.url).toBe(src.guid);
    expect(jobs[0]!.published_at).toBe(new Date(src.pubDate * 1000).toISOString());
    expect(jobs[0]!.location).toBe(src.locationRestrictions.join(', '));
    expect(jobs[0]!.workplace).toBe('remote');
  });

  it('sem restrição de local vira Worldwide', () => {
    const [job] = normalizeHimalayas({ jobs: [{ ...payload.jobs[0], locationRestrictions: [] }] });
    expect(job!.location).toBe('Worldwide');
  });
});

describe('remoteok', () => {
  const payload = jsonFixture('remoteok.json');
  const jobs = normalizeRemoteOk(payload);

  it('ignora o aviso legal e normaliza o resto', () => {
    expect(payload[0].legal).toBeTruthy();
    expect(jobs).toHaveLength(payload.length - 1);
    expectWellFormed(jobs, 'remoteok');
    expect(jobs[0]!.id).toBe(`remoteok:${payload[1].id}`);
    expect(jobs[0]!.title).toBe(payload[1].position);
    expect(jobs[0]!.published_at).toBe(new Date(payload[1].date).toISOString());
  });
});

describe('wwr', () => {
  const jobs = normalizeWwr(fixture('wwr.xml'));

  it('normaliza o RSS real separando empresa e cargo', () => {
    expect(jobs).toHaveLength(3);
    expectWellFormed(jobs, 'wwr');
    expect(jobs[0]!.company).toBe('Knock');
    expect(jobs[0]!.title).toBe('Lending Manager (Front End) - Remote');
    expect(jobs[0]!.id).toBe('wwr:knock-lending-manager-front-end-remote');
    expect(jobs[0]!.location).toBe('Anywhere in the World');
    expect(jobs[0]!.published_at).toBe('2026-11-01T07:31:04.000Z');
    expect(jobs[0]!.employment_type).toBe('Full-Time');
  });
});

describe('inhire', () => {
  const company = { name: 'Alice', ats: 'inhire', id: 'alice' } as const;
  const list = jsonFixture('inhire.json');
  const detail = jsonFixture('inhire-detail.json');

  it('normaliza a listagem real com o detalhe da primeira vaga', () => {
    const jobs = normalizeInhire(list, company, { [detail.jobId]: detail });
    expect(jobs).toHaveLength(list.jobsPage.length);
    expect(jobs[0]).toMatchObject({
      id: `inhire:alice:${detail.jobId}`,
      source: 'inhire',
      board: 'inhire:alice',
      company: 'Alice',
      title: 'Business Analyst | Autorização',
      url: `https://alice.inhire.app/vagas/${detail.jobId}`,
      location: 'São Paulo, SP, Brazil · Híbrido com dois dias fixos e com disponibilidade para outros dias quando necessario',
      workplace: 'onsite',
      published_at: detail.publishedAt,
      employment_type: 'CLT',
      salary: null,
    });
    expect(jobs[0]!.description).toContain('Sobre a Alice');
    expect(jobs[0]!.description).not.toContain('<');
  });

  it('sem detalhe fica sem data e sem descrição, com o país por extenso', () => {
    const jobs = normalizeInhire(list, company);
    const remote = jobs.find((j) => j.title === 'Staff Security Engineer')!;
    expect(remote).toMatchObject({ location: 'Brazil', workplace: 'remote', published_at: null, description: '', employment_type: null });
    expect(jobs.find((j) => j.title === 'Product Manager')).toMatchObject({ workplace: 'hybrid', location: 'São Paulo, SP, Brazil' });
  });

  it('usa publishedAt, depois createdAt, e nunca lastPublishedAt/updatedAt', () => {
    const id = list.jobsPage[0].jobId;
    const at = (d: object) => normalizeInhire(list, company, { [id]: d })[0]!.published_at;
    expect(detail.lastPublishedAt).not.toBe(detail.publishedAt);
    expect(at(detail)).toBe(detail.publishedAt);
    expect(at({ ...detail, publishedAt: null, createdAt: '2026-10-01T10:00:00.000Z' })).toBe('2026-10-01T10:00:00.000Z');
    expect(at({ lastPublishedAt: detail.lastPublishedAt, updatedAt: detail.updatedAt })).toBeNull();
  });

  it('só entram vagas com status published', () => {
    const payload = { jobsPage: [{ ...list.jobsPage[0], status: 'draft' }, { ...list.jobsPage[1], status: undefined }, list.jobsPage[2]] };
    expect(normalizeInhire(payload, company).map((j) => j.id)).toEqual([`inhire:alice:${list.jobsPage[2].jobId}`]);
  });

  it('expande o código do país só no formato cidade, estado, país (ou país sozinho)', () => {
    expect(expandCountry('São Paulo, SP, BR')).toBe('São Paulo, SP, Brazil');
    expect(expandCountry('BR')).toBe('Brazil');
    expect(expandCountry('Austin, TX, US')).toBe('Austin, TX, United States');
    expect(expandCountry('Florianópolis, SC')).toBe('Florianópolis, SC');
    expect(expandCountry('Remoto')).toBe('Remoto');
    expect(expandCountry('')).toBe('');
  });
});
