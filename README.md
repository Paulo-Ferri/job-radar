# job-radar

Coletor diário de vagas de frontend, em código puro (sem IA). Lê as vagas direto dos sistemas de
recrutamento (ATS) das empresas listadas e de alguns agregadores, aplica filtros objetivos e grava
o resultado em `data/`. Roda no GitHub Actions todo dia às 07:17 (Brasília), disparado por um Worker da Cloudflare
(ver [Agendamento](#agendamento)). A curadoria fina é
feita por outra rotina, fora deste repositório, que lê `data/latest.json`.

Por que ATS: eles informam a data real de publicação e só listam vagas abertas.

## Como rodar

```sh
npm ci
npm run collect    # coleta e grava data/*.json
npm run summary    # resumo da última coleta local (amostra, cortes por motivo)
npm test
npm run typecheck
```

Requer Node 22. Sem chave de API, sem banco de dados.

## Agendamento

O `schedule` do GitHub Actions atrasa horas e às vezes pula o dia, então o workflow
`collect.yml` só tem `workflow_dispatch`. Quem dispara é o Worker em `cloudflare/`, com dois crons:

- 07:17 (Brasília): dispara a coleta.
- 08:02: dispara de novo só se nenhuma execução de hoje deu certo ou está em andamento.

A coleta continua rodando no Actions e gravando `data/` neste repositório.

Publicar (uma vez, e de novo quando mudar `cloudflare/`):

```sh
cd cloudflare
npx wrangler login
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
```

O `GITHUB_TOKEN` é um token fine-grained do GitHub restrito a este repositório, com a permissão
**Actions: Read and write**. Quando ele expirar, o Worker passa a falhar (aparece nos logs do
Worker no painel da Cloudflare); basta gerar outro e repetir o `secret put`.

Para mudar o horário, edite `crons` e `PRIMARY_CRON` em `cloudflare/wrangler.toml` (em UTC).

## Fontes

| Fonte | Tipo | Data usada |
|---|---|---|
| Greenhouse | ATS | `first_published` (nunca `updated_at`) |
| Ashby | ATS | `publishedAt` (vagas com `isListed: false` são ignoradas) |
| Lever | ATS | `createdAt` (tenta `api.lever.co` e depois `api.eu.lever.co`) |
| Workable | ATS | `published_on` (precisão de dia) |
| SmartRecruiters | ATS | `releasedDate` (descrição buscada só para títulos que passam no filtro) |
| Recruitee | ATS | `published_at` |
| InHire | ATS | `publishedAt`; se faltar, `createdAt` (nunca `lastPublishedAt`/`updatedAt`). Detalhe buscado só para título e modalidade que podem passar |
| Himalayas | agregador | `pubDate` (busca por termos, ver `himalayas` em `config/filters.json`) |
| RemoteOK | agregador | `date` |
| We Work Remotely | agregador | `pubDate` do RSS (front-end e full-stack) |

Gupy não tem API pública utilizável sem token, então empresas que usam Gupy não são coletadas.

## Como adicionar uma empresa

1. Descubra o ATS e o identificador pelo link de uma vaga:
   - `job-boards.greenhouse.io/{id}/jobs/...` → `greenhouse`
   - `jobs.ashbyhq.com/{id}/...` → `ashby`
   - `jobs.lever.co/{id}/...` → `lever`
   - `apply.workable.com/{id}/...` → `workable`
   - `jobs.smartrecruiters.com/{id}/...` → `smartrecruiters`
   - `{id}.recruitee.com/...` → `recruitee`
   - `{id}.inhire.app/vagas/...` → `inhire`
2. Confirme que responde com vagas: `npm run probe -- "Nome" id-provavel outro-id`. Confira a
   amostra: identificadores curtos (`flash`, `circle`, `dock`) costumam ser de outra empresa. O
   Workable devolve 429 com facilidade; se aparecer nos erros, repita só ele mais tarde.
3. Acrescente em `config/companies.json`: `{ "name": "GitLab", "ats": "greenhouse", "id": "gitlab" }`

Na primeira coleta de uma empresa nova, só entram em `latest.json` as vagas com data de publicação
dentro da janela; o resto vira linha de base. `data/discovered.json` lista boards de
Greenhouse/Ashby/Lever vistos em links de agregadores e que ainda não estão em `companies.json`
(nada é adicionado automaticamente).

## Filtros (`config/filters.json`)

O coletor só corta o que é objetivamente fora; na dúvida mantém.

- **Título, cortes que valem sempre** (`cut_always`): nível (staff, principal, lead, manager, head,
  director, architect, intern, estágio, junior...) e stack conflitante (react native, angular, java,
  .net, php, python, ruby, golang, kotlin, wordpress, salesforce, ios, android, flutter).
  "Senior"/"sênior" não é cortado.
- **Título, cortes condicionais** (`cut_unless_strong_frontend`): data, mobile, qa, backend, devops,
  sre só cortam quando o título não tem termo forte de frontend (`strong_frontend_terms`).
- **Título, passe**: termos de `frontend_terms`. Títulos genéricos (`generic_titles`) só passam se a
  descrição citar React ou TypeScript. O resto é cortado.
- **Modalidade**: presencial declarado pela fonte é cortado sempre. Híbrida só passa quando o campo
  de local é no Brasil (país ou cidade brasileira); ela sai com `workplace: "hybrid"` e quem consome
  decide. Híbrida fora do Brasil, ou sem local, é cortada.
- **Local**: quando o local nomeia país/região fora
  da América Latina, a vaga só passa se o próprio local também citar uma região aceita (Brazil,
  LATAM, Americas, Worldwide, Anywhere, Global, cidades e países da América Latina) ou se a
  descrição citar Brazil/Brasil, LATAM, Latin America, South America ou Americas. Worldwide,
  Anywhere e Global na descrição não salvam local restrito. "Remote" sem região passa.
- **Janela** (`window_hours`, padrão 72): uma vaga entra em `latest.json` se `published_at` está na
  janela, ou se foi vista pela primeira vez na janela em um board que já tinha linha de base.

## Arquivos de saída (contrato)

### `data/latest.json`

Vagas que passaram nos filtros e são novas na janela, da mais recente para a mais antiga.

```json
{
  "generated_at": "ISO 8601 UTC",
  "window_hours": 72,
  "stats": { "boards_ok": 0, "boards_failed": 0, "jobs_seen": 0, "jobs_in_window": 0 },
  "jobs": [
    {
      "id": "greenhouse:gitlab:8199086002",
      "source": "greenhouse | ashby | lever | workable | smartrecruiters | recruitee | inhire | himalayas | remoteok | wwr",
      "company": "GitLab",
      "title": "Intermediate Frontend Engineer",
      "url": "link direto da vaga",
      "location": "texto original do local",
      "workplace": "remote | hybrid | onsite | unknown",
      "region_hint": "brazil | latam | americas | worldwide | restricted | unknown",
      "published_at": "ISO ou null",
      "first_seen_at": "ISO",
      "date_confidence": "ats | feed | first_seen",
      "employment_type": "texto ou null",
      "salary": "texto original ou null",
      "hints": { "years": [3, 5], "mentions_react": true, "mentions_typescript": true },
      "description": "texto puro, sem HTML, cortado em 6000 caracteres"
    }
  ]
}
```

- `stats.boards_*` contam empresas + agregadores; `jobs_seen` é o total visto depois da deduplicação
  (anúncios da mesma vaga em vários locais contam uma vez).
- `date_confidence`: `ats` (data do ATS), `feed` (data do agregador), `first_seen` (a fonte não
  informou data; vale `first_seen_at`).
- `region_hint` vem do local; se o local não diz nada, da descrição.
- `hints.years`: números de padrões como "5+ years" e "3 anos de experiência" na descrição.
- Deduplicação na mesma fonte: por `id`, e mesma empresa + mesmo título em locais diferentes viram
  uma vaga só. Cada anúncio é filtrado sozinho; o `id`, a `url` e as datas são do anúncio mais
  recente que passa (o novo na janela, se houver), e `location` junta os locais de todos com `; `
  (primeiro os que passam). Um local novo de uma vaga antiga volta a aparecer na janela.
- Deduplicação entre fontes: por empresa + título normalizados, ficando a vaga do ATS quando existe
  também em agregador.

### `data/state.json`

```json
{
  "boards": { "greenhouse:gitlab": "ISO da primeira coleta bem-sucedida (linha de base)" },
  "jobs": [
    { "id": "...", "company": "...", "title": "...", "url": "...", "first_seen_at": "ISO", "closed_at": null },
    { "id": "...", "first_seen_at": "ISO", "closed_at": null }
  ]
}
```

Todas as vagas já vistas (inclusive as que não passam nos filtros), sem descrição. `company`, `title`
e `url` só são guardados para as vagas que passam no filtro de título; as demais (mais de 90%)
ficam só com `id`, `first_seen_at` e `closed_at`, para o arquivo não crescer com a lista de
empresas. O arquivo só muda quando uma vaga abre ou fecha. `closed_at` é preenchido quando a consulta do board deu certo e a
vaga não veio; falha de board não fecha nada, e vaga que reaparece volta a `null`. Entradas fechadas
há mais de 90 dias são removidas; as que não passam no filtro de título saem depois de 14 dias. Nos agregadores, `closed_at` significa apenas que a vaga saiu do
feed consultado.

### `data/health.json`

```json
{
  "generated_at": "ISO",
  "boards": {
    "greenhouse:gitlab": { "name": "GitLab", "ok": true, "jobs": 250, "error": null, "consecutive_failures": 0, "last_ok_at": "ISO" }
  }
}
```

`error` é um código (`http_404`, `http_429`, `timeout`, `network`, `parse`). Uma fonte que falha não
derruba a execução; o processo só termina com erro se todas falharem.

### `data/discovered.json`

`[{ "name", "ats", "id", "first_seen_at" }]` — candidatos a entrar em `config/companies.json`.

## Robustez

Até 5 requisições simultâneas, timeout de 20 s e 1 nova tentativa por requisição. O InHire tem
fila própria: 2 requisições simultâneas, pausa de 0,4 s depois de cada uma e nenhuma nova tentativa.
User-Agent: `job-radar/1.0`.
