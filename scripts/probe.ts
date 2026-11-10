/**
 * Testa identificadores prováveis de uma empresa nos ATS suportados.
 * Uso: npm run probe -- "Nome da Empresa" slug1 slug2 ...
 *      npm run probe -- --file candidatos.json     ({ "Nome": ["slug1", "slug2"] })
 * Só mostra o que respondeu com vagas; confira a amostra antes de adicionar a companies.json.
 */
import { readFileSync } from 'node:fs';
import { getJson } from '../src/http.js';

interface Hit {
  ats: string;
  id: string;
  jobs: number;
  label: string;
  sample: string[];
}

type Probe = (id: string) => Promise<Hit | null>;

const hit = (ats: string, id: string, jobs: number, label: string, sample: string[]): Hit | null =>
  jobs > 0 ? { ats, id, jobs, label, sample: sample.slice(0, 3) } : null;

const probes: Record<string, Probe> = {
  greenhouse: async (id) => {
    const r = await getJson<any>(`https://boards-api.greenhouse.io/v1/boards/${id}/jobs`);
    const jobs = r.jobs ?? [];
    return hit('greenhouse', id, jobs.length, jobs[0]?.company_name ?? '', jobs.map((j: any) => `${j.title} @ ${j.location?.name}`));
  },
  ashby: async (id) => {
    const r = await getJson<any>(`https://api.ashbyhq.com/posting-api/job-board/${id}`);
    const jobs = r.jobs ?? [];
    return hit('ashby', id, jobs.length, '', jobs.map((j: any) => `${j.title} @ ${j.location}`));
  },
  lever: async (id) => {
    const r = await getJson<any>(`https://api.lever.co/v0/postings/${id}?mode=json`);
    return Array.isArray(r) ? hit('lever', id, r.length, '', r.map((j: any) => `${j.text} @ ${j.categories?.location}`)) : null;
  },
  'lever-eu': async (id) => {
    const r = await getJson<any>(`https://api.eu.lever.co/v0/postings/${id}?mode=json`);
    return Array.isArray(r) ? hit('lever (eu)', id, r.length, '', r.map((j: any) => `${j.text} @ ${j.categories?.location}`)) : null;
  },
  workable: async (id) => {
    const r = await getJson<any>(`https://apply.workable.com/api/v1/widget/accounts/${id}`);
    const jobs = r.jobs ?? [];
    return hit('workable', id, jobs.length, r.name ?? '', jobs.map((j: any) => `${j.title} @ ${j.country}`));
  },
  smartrecruiters: async (id) => {
    const r = await getJson<any>(`https://api.smartrecruiters.com/v1/companies/${id}/postings?limit=3`);
    const jobs = r.content ?? [];
    return hit('smartrecruiters', id, r.totalFound ?? 0, jobs[0]?.company?.name ?? '', jobs.map((j: any) => `${j.name} @ ${j.location?.fullLocation}`));
  },
  recruitee: async (id) => {
    const r = await getJson<any>(`https://${id}.recruitee.com/api/offers/`);
    const jobs = r.offers ?? [];
    return hit('recruitee', id, jobs.length, jobs[0]?.company_name ?? '', jobs.map((j: any) => `${j.title} @ ${j.location}`));
  },
};

async function probeCompany(name: string, ids: string[]): Promise<void> {
  const hits: Hit[] = [];
  const errors: string[] = [];
  await Promise.all(
    ids.flatMap((id) =>
      Object.entries(probes).map(async ([ats, probe]) => {
        try {
          const h = await probe(id);
          if (h) hits.push(h);
        } catch (e) {
          const code = (e as { code?: string }).code ?? 'error';
          if (code !== 'http_404' && code !== 'parse' && code !== 'network') errors.push(`${ats}:${id}=${code}`);
        }
      }),
    ),
  );
  if (!hits.length) console.log(`-- ${name}: nada${errors.length ? ` (erros: ${errors.join(', ')})` : ''}`);
  for (const h of hits) {
    console.log(`OK ${name}: ${h.ats} "${h.id}" ${h.jobs} vagas${h.label ? ` [${h.label}]` : ''}\n     ${h.sample.join(' | ')}`);
  }
}

const args = process.argv.slice(2);
const candidates: Record<string, string[]> =
  args[0] === '--file' ? JSON.parse(readFileSync(args[1]!, 'utf8')) : { [args[0] ?? '']: args.slice(1) };
for (const [name, ids] of Object.entries(candidates)) await probeCompany(name, ids);
