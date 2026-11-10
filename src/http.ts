const USER_AGENT = 'job-radar/1.0';
const TIMEOUT_MS = 20_000;
const MAX_CONCURRENCY = 5;
const RETRIES = 1;
const MAX_RETRY_AFTER_S = 30;

export class HttpError extends Error {
  constructor(
    public code: string,
    public status: number | null,
    url: string,
    /** Segundos pedidos pelo servidor em Retry-After (só em 429/503). */
    public retryAfter: number | null = null,
  ) {
    super(`${code} ${url}`);
  }
}

let active = 0;
const queue: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENCY) await new Promise<void>((resolve) => queue.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

async function once(url: string, accept: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new HttpError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', null, url);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new HttpError(`http_${res.status}`, res.status, url, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
  }
  try {
    return await res.text();
  } catch {
    throw new HttpError('timeout', null, url);
  }
}

const retryable = (e: unknown) =>
  e instanceof HttpError && (e.status === null || e.status === 429 || e.status >= 500);

/** GET com User-Agent fixo, timeout de 20 s, 1 nova tentativa e no máximo 5 requisições simultâneas. */
export async function getText(url: string, accept = 'application/json'): Promise<string> {
  return withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await once(url, accept);
      } catch (e) {
        if (attempt >= RETRIES || !retryable(e)) throw e;
        // Em 429 respeita o Retry-After (até 30 s); nos demais casos espera 1 s.
        const wait = e instanceof HttpError && e.status === 429 ? Math.min(e.retryAfter ?? 5, MAX_RETRY_AFTER_S) : 1;
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }
  });
}

export async function getJson<T = unknown>(url: string): Promise<T> {
  const text = await getText(url);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError('parse', null, url);
  }
}

export function errorCode(e: unknown): string {
  if (e instanceof HttpError) return e.code;
  return `error: ${(e as Error)?.message ?? String(e)}`.slice(0, 200);
}
