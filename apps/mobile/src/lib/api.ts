import type {
  Card,
  CardLanguage,
  CardQuery,
  CardSet,
  CollectionItem,
  CollectionStats,
  Marketplace,
  Paginated,
  PriceHistory,
  PriceQuote,
  SetKind,
} from '@op/shared';
import Constants from 'expo-constants';
import { cacheJson, getSetting, readCachedJson } from './storage';

/**
 * Client du backend.
 *
 * L'adresse est réglable depuis l'app (écran Réglages) : en développement le
 * téléphone doit joindre le poste de travail par son IP locale, pas localhost.
 */

const SETTING_KEY = 'apiBaseUrl';

/** Devine l'adresse du poste de dev à partir de celle du serveur Metro. */
function guessDevUrl(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  const host = hostUri?.split(':')[0];
  return host ? `http://${host}:4000` : 'http://localhost:4000';
}

let cachedBaseUrl: string | null = null;

export async function getBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  const stored = await getSetting(SETTING_KEY);
  cachedBaseUrl = stored ?? guessDevUrl();
  return cachedBaseUrl;
}

export function invalidateBaseUrl(): void {
  cachedBaseUrl = null;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function get<T>(path: string, options: { cacheKey?: string } = {}): Promise<T> {
  const baseUrl = await getBaseUrl();

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new ApiError(response.status, `Le serveur a répondu ${response.status}`);
    }
    const payload = (await response.json()) as T;
    if (options.cacheKey) await cacheJson(options.cacheKey, payload);
    return payload;
  } catch (error) {
    // Hors ligne : on ressert la dernière réponse connue plutôt qu'un écran vide.
    if (options.cacheKey) {
      const cached = await readCachedJson<T>(options.cacheKey);
      if (cached) return cached;
    }
    throw error;
  }
}

async function send<T>(path: string, method: string, body: unknown): Promise<T> {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiError(response.status, `Le serveur a répondu ${response.status}`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------

export interface SetGroup {
  kind: SetKind;
  sets: CardSet[];
}

export function fetchSets(
  language?: CardLanguage,
): Promise<{ sets: CardSet[]; groups: SetGroup[] }> {
  // L'édition fait partie de la clé de cache : les produits, leurs noms et
  // leurs effectifs en dépendent, et resservir ceux d'une autre édition hors
  // ligne afficherait un catalogue faux plutôt qu'un catalogue ancien.
  const qs = language ? `?language=${language}` : '';
  return get(`/sets${qs}`, { cacheKey: `sets${qs}` });
}

export function fetchEditions(): Promise<{
  editions: Array<{ language: CardLanguage; cardCount: number }>;
}> {
  return get('/editions', { cacheKey: 'editions' });
}

export function fetchFacets(): Promise<{
  rarities: string[];
  types: string[];
  attributes: string[];
}> {
  return get('/facets', { cacheKey: 'facets' });
}

function toQueryString(query: CardQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params.toString();
}

export function fetchCards(query: CardQuery): Promise<Paginated<Card>> {
  const qs = toQueryString(query);
  // Seule la première page est mise en cache : c'est elle qui sert hors ligne.
  const cacheKey = !query.offset ? `cards:${qs}` : undefined;
  return get(`/cards?${qs}`, { cacheKey });
}

export function fetchCard(id: string): Promise<{ card: Card; variants: Card[] }> {
  return get(`/cards/${encodeURIComponent(id)}`, { cacheKey: `card:${id}` });
}

export function fetchPrices(
  id: string,
  days = 30,
): Promise<{
  cardId: string;
  quotes: PriceQuote[];
  history: PriceHistory[];
  /** Renseigné quand le prix provient d'une autre impression de la même carte. */
  pricedAs?: string;
}> {
  return get(`/cards/${encodeURIComponent(id)}/prices?days=${days}`, {
    cacheKey: `prices:${id}:${days}`,
  });
}

export function fetchServerCollection(
  marketplace: Marketplace,
): Promise<{ items: CollectionItem[]; cards: Card[]; stats: CollectionStats }> {
  return get(`/collection?marketplace=${marketplace}`, { cacheKey: `collection:${marketplace}` });
}

export function pushCollection(items: CollectionItem[]): Promise<{ ok: boolean }> {
  return send('/collection', 'PUT', items);
}

export function fetchHealth(): Promise<{
  status: string;
  providers: Array<{ marketplace: Marketplace; configured: boolean }>;
}> {
  return get('/health');
}
