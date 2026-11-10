import { describe, expect, it } from 'vitest';
import { filters } from './helpers.js';
import { classifyTitle, locationFilter, titleFilter } from '../src/filters.js';
import { inferWorkplace, regionHint } from '../src/region.js';
import { buildHints, extractYears } from '../src/hints.js';
import { htmlToText } from '../src/text.js';
import { extractAtsLinks } from '../src/discover.js';

const title = (t: string, description = '') => titleFilter(t, description, filters);
const loc = (location: string, description = '', workplace: Parameters<typeof locationFilter>[0] = 'remote') =>
  locationFilter(workplace, location, description, filters);

describe('filtro de título', () => {
  it.each([
    'Senior Frontend Engineer',
    'Sênior Front-end Developer',
    'Front End Developer',
    'React Developer',
    'Software Engineer, Next.js',
    'UI Engineer',
    'Web Engineer',
    'Fullstack Engineer',
    'Full-Stack Developer',
    'Full Stack Engineer (TypeScript)',
    'Pessoa Desenvolvedora Front-end Pleno',
    'Senior JavaScript/React Engineer',
  ])('passa: %s', (t) => expect(title(t)).toEqual({ pass: true, reason: null }));

  it.each([
    ['Staff Frontend Engineer', 'level:staff'],
    ['Principal Frontend Engineer', 'level:principal'],
    ['Frontend Tech Lead', 'level:lead'],
    ['Líder Técnico Frontend', 'level:líder'],
    ['Engineering Manager, Frontend', 'level:manager'],
    ['Head of Frontend', 'level:head'],
    ['Frontend Architect', 'level:architect'],
    ['Frontend Intern', 'level:intern'],
    ['Estágio em Front-end', 'level:estágio'],
    ['Junior React Developer', 'level:junior'],
    ['Desenvolvedor Front-end Júnior', 'level:junior'],
    ['Frontend Developer Jr.', 'level:jr'],
  ])('corta por nível: %s', (t, reason) => expect(title(t)).toEqual({ pass: false, reason }));

  it.each([
    ['React Native Engineer', 'stack:react native'],
    ['Frontend Engineer (Angular)', 'stack:angular'],
    ['Fullstack Developer (Java + React)', 'stack:java'],
    ['Full Stack .NET Developer', 'stack:.net'],
    ['Fullstack Engineer (Python/React)', 'stack:python'],
    ['Full Stack Engineer - Ruby on Rails', 'stack:ruby'],
    ['WordPress Frontend Developer', 'stack:wordpress'],
    ['Frontend Engineer, iOS', 'stack:ios'],
  ])('corta por stack conflitante mesmo com termo de frontend: %s', (t, reason) =>
    expect(title(t)).toEqual({ pass: false, reason }));

  it('não confunde "java" com "javascript" nem "intern" com "internal"', () => {
    expect(title('JavaScript Frontend Engineer').pass).toBe(true);
    expect(title('Frontend Engineer, Internal Tools').pass).toBe(true);
  });

  it('palavras genéricas só cortam sem termo forte de frontend', () => {
    expect(title('Frontend Engineer, Data Platform').pass).toBe(true);
    expect(title('React Engineer - Mobile Web').pass).toBe(true);
    expect(title('UI Engineer, DevOps Tooling').pass).toBe(true);
    expect(title('Fullstack Engineer (Backend-leaning)')).toEqual({ pass: false, reason: 'off_area:backend' });
    expect(title('Full Stack Engineer, Data')).toEqual({ pass: false, reason: 'off_area:data' });
    expect(title('Web Engineer - QA')).toEqual({ pass: false, reason: 'off_area:qa' });
    expect(title('Backend Engineer')).toEqual({ pass: false, reason: 'off_area:backend' });
    expect(title('Software Engineer, SRE')).toEqual({ pass: false, reason: 'off_area:sre' });
  });

  it('não corta senior/sênior', () => {
    expect(title('Senior Frontend Engineer').pass).toBe(true);
    expect(title('Desenvolvedor Front-end Sênior').pass).toBe(true);
  });

  it('título genérico depende de React ou TypeScript na descrição', () => {
    expect(classifyTitle('Software Engineer', filters).status).toBe('generic');
    expect(title('Software Engineer', 'Our stack: React, Node.')).toEqual({ pass: true, reason: null });
    expect(title('Product Engineer', 'We write TypeScript.').pass).toBe(true);
    expect(title('Desenvolvedor(a) Pleno', 'Experiência com React.').pass).toBe(true);
    expect(title('Engenheiro(a) de Software', 'Go e Kubernetes')).toEqual({
      pass: false,
      reason: 'generic_without_react_ts',
    });
    expect(title('Software Engineer', 'We are reactive and fast.').pass).toBe(false);
  });

  it('corta o que não é frontend nem genérico', () => {
    expect(title('Account Executive', 'React')).toEqual({ pass: false, reason: 'title_not_frontend' });
    expect(title('Product Designer')).toEqual({ pass: false, reason: 'title_not_frontend' });
  });
});

describe('filtro de local', () => {
  it('"Remote" sem região passa', () => {
    expect(loc('Remote')).toEqual({ pass: true, reason: null, region_hint: 'unknown' });
    expect(loc('')).toMatchObject({ pass: true, region_hint: 'unknown' });
  });

  it('"Remote, US" sem menção a LATAM não passa', () => {
    expect(loc('Remote, US')).toEqual({ pass: false, reason: 'region_restricted', region_hint: 'restricted' });
    expect(loc('Remote, United States').pass).toBe(false);
    expect(loc('Austin, TX').pass).toBe(false);
    expect(loc('Remote - Europe').pass).toBe(false);
    expect(loc('United Kingdom; Germany').pass).toBe(false);
  });

  it('local restrito passa quando a descrição menciona região aceita', () => {
    expect(loc('Remote, US', 'Open to candidates in Brazil.')).toMatchObject({ pass: true, region_hint: 'brazil' });
    expect(loc('Remote, US', 'Hiring across LATAM')).toMatchObject({ pass: true, region_hint: 'latam' });
    expect(loc('Remote, US', 'We are a global team')).toMatchObject({ pass: true, region_hint: 'unknown' });
    // Cidades e países da América Latina só contam no campo de local, não na descrição.
    expect(loc('Remote, US', 'Offices in Lima, Santiago and Mexico.').pass).toBe(false);
  });

  it('classifica region_hint pelo local', () => {
    expect(loc('Remote - Brazil').region_hint).toBe('brazil');
    expect(loc('Remoto, Brasil').region_hint).toBe('brazil');
    expect(loc('São Paulo').region_hint).toBe('brazil');
    expect(loc('Remote, US; Remote, Brazil')).toMatchObject({ pass: true, region_hint: 'brazil' });
    expect(loc('LATAM').region_hint).toBe('latam');
    expect(loc('Remote (Latin America)').region_hint).toBe('latam');
    expect(loc('Argentina').region_hint).toBe('latam');
    expect(loc('Poland; Peru; Colombia').region_hint).toBe('latam');
    expect(loc('Americas').region_hint).toBe('americas');
    expect(loc('Worldwide').region_hint).toBe('worldwide');
    expect(loc('Anywhere in the World').region_hint).toBe('worldwide');
    expect(loc('Remote - Global').region_hint).toBe('worldwide');
  });

  it('corta presencial e híbrido declarados pelo ATS, mesmo no Brasil', () => {
    expect(loc('São Paulo', '', 'hybrid')).toMatchObject({ pass: false, reason: 'workplace:hybrid' });
    expect(loc('São Paulo', '', 'onsite')).toMatchObject({ pass: false, reason: 'workplace:onsite' });
    expect(loc('São Paulo', '', 'unknown').pass).toBe(true);
  });

  it('não trata "us" minúsculo nem siglas brasileiras como restrição', () => {
    expect(regionHint('Join us remotely', '', filters.location)).toBe('unknown');
    expect(regionHint('Joinville, SC', '', filters.location)).toBe('unknown');
  });

  it('infere a modalidade pelo texto do local', () => {
    expect(inferWorkplace('Remote, United States')).toBe('remote');
    expect(inferWorkplace('Híbrido - São Paulo')).toBe('hybrid');
    expect(inferWorkplace('São Paulo')).toBe('unknown');
  });
});

describe('hints e texto', () => {
  it('extrai anos de experiência', () => {
    expect(extractYears('5+ years of experience with React')).toEqual([5]);
    expect(extractYears('3 anos de experiência')).toEqual([3]);
    expect(extractYears('3-5 years; at least 8 yrs overall')).toEqual([3, 5, 8]);
    expect(extractYears('founded 12 years ago, 401k, 100 years')).toEqual([]);
  });

  it('detecta React e TypeScript', () => {
    expect(buildHints('Frontend Engineer', 'React.js and TypeScript, 4+ years')).toEqual({
      years: [4],
      mentions_react: true,
      mentions_typescript: true,
    });
    expect(buildHints('Engineer', 'reactive systems').mentions_react).toBe(false);
  });

  it('converte HTML escapado em texto', () => {
    expect(htmlToText('&lt;p&gt;Hello&amp;nbsp;&lt;strong&gt;world&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;A &amp;amp; B&lt;/li&gt;&lt;/ul&gt;')).toBe(
      'Hello world\n\n- A & B',
    );
  });

  it('extrai boards de ATS de links', () => {
    expect(
      extractAtsLinks(
        'Apply: https://boards.greenhouse.io/acme/jobs/1 or https://job-boards.greenhouse.io/Beta/jobs/2 ' +
          'https://jobs.ashbyhq.com/kraken.com/abc https://jobs.lever.co/tractian/xyz https://jobs.eu.lever.co/eu-co/1',
      ),
    ).toEqual([
      { ats: 'greenhouse', id: 'acme' },
      { ats: 'greenhouse', id: 'beta' },
      { ats: 'ashby', id: 'kraken.com' },
      { ats: 'lever', id: 'tractian' },
      { ats: 'lever', id: 'eu-co' },
    ]);
  });
});
