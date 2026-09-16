/**
 * Client HTTP partagé par tous les connecteurs.
 *
 * Les APIs marketplace imposent toutes des quotas (Cardmarket ~5000 requêtes/jour,
 * TCGplayer 300 req/min, eBay 5000 appels/jour) : on sérialise les appels par hôte
 * avec un intervalle minimum, et on réessaie sur 429 / 5xx avec un back-off.
 */

const lastCallByHost = new Map<string, number>();

/** Intervalle minimum entre deux appels sur un même hôte, en millisecondes. */
const MIN_INTERVAL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttle(host: string): Promise<void> {
  const last = lastCallByHost.get(host) ?? 0;
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallByHost.set(host, Date.now());
}

export interface RequestOptions extends RequestInit {
  /** Nombre de tentatives supplémentaires après un échec réessayable. */
  retries?: number;
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} sur ${url}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { retries = 3, timeoutMs = 20_000, ...init } = options;
  const host = new URL(url).host;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await throttle(host);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.status === 429 || response.status >= 500) {
        // Cardmarket et eBay renvoient parfois un Retry-After, on le respecte.
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 2 ** attempt * 1000;
        lastError = new HttpError(response.status, url, await response.text());
        if (attempt < retries) {
          await sleep(delay);
          continue;
        }
        throw lastError;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, options);
  if (!response.ok) {
    throw new HttpError(response.status, url, await response.text());
  }
  return (await response.json()) as T;
}
