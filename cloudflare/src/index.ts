// Dispara o workflow de coleta no GitHub Actions no horário certo.
// O agendador do próprio GitHub atrasa horas e pula dias; o cron da Cloudflare não.
// A coleta em si continua rodando no Actions e gravando data/ no repositório.

interface Env {
  GITHUB_TOKEN: string; // segredo: token fine-grained com Actions (read and write) no repositório
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
  GITHUB_REF: string;
  PRIMARY_CRON: string;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

async function github(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "job-radar-trigger",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${init.method ?? "GET"} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

async function dispatch(env: Env): Promise<void> {
  await github(env, "/dispatches", { method: "POST", body: JSON.stringify({ ref: env.GITHUB_REF }) });
}

// Há alguma execução de hoje (UTC) que deu certo ou ainda está em andamento?
async function collectedToday(env: Env, now: Date): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  const res = await github(env, `/runs?created=${encodeURIComponent(">=" + day)}&per_page=20`);
  const body = (await res.json()) as { workflow_runs: { status: string; conclusion: string | null }[] };
  return body.workflow_runs.some((r) => r.status !== "completed" || r.conclusion === "success");
}

export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const now = new Date(event.scheduledTime);
    if (event.cron !== env.PRIMARY_CRON && (await collectedToday(env, now))) {
      console.log("Coleta de hoje já rodou; nada a fazer.");
      return;
    }
    await dispatch(env);
    console.log(`Workflow ${env.GITHUB_WORKFLOW} disparado (cron ${event.cron}).`);
  },
};
