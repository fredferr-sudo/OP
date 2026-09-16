import type { CardSet } from '@op/shared';
import { requestJson } from '../../lib/http.ts';
import {
  baseCode,
  inferSetKind,
  normalizeCategory,
  normalizeColors,
  parseArtVariant,
  parseNumber,
  setIdFromCode,
  splitList,
} from '../classify.ts';
import type { CatalogCard, CatalogProvider } from '../types.ts';

/**
 * optcgapi.com — source communautaire ouverte, sans clé.
 * Sert de repli quand aucune clé apitcg n'est configurée.
 */

interface OptcgCard {
  card_set_id: string;
  card_name: string;
  card_type: string;
  card_color: string;
  card_cost?: number | string;
  card_power?: number | string;
  counter_amount?: number | string;
  life?: number | string;
  card_text?: string;
  attribute?: string;
  sub_types?: string;
  rarity?: string;
  set_id?: string;
  set_name?: string;
  image_url?: string;
  trigger?: string;
}

/**
 * Plusieurs chemins sont tentés dans l'ordre.
 *
 * Cette API communautaire ne publie pas de contrat versionné et ses URL ont déjà
 * changé : coder une seule adresse en dur, c'est se condamner à un 404 le jour où
 * elle bouge. On essaie donc les variantes connues et on retient la première qui
 * renvoie une liste de cartes. `npm run api:probe` sert à établir cette liste.
 */
const CARD_URLS = [
  'https://optcgapi.com/api/allCards/',
  'https://optcgapi.com/api/allCards',
  'https://optcgapi.com/api/cards/',
  'https://optcgapi.com/api/allCards/en/',
];

/** Les APIs enveloppent parfois la liste dans `data`, `cards` ou `results`. */
function extractList(payload: unknown): OptcgCard[] | null {
  if (Array.isArray(payload)) return payload as OptcgCard[];
  if (payload && typeof payload === 'object') {
    for (const key of ['data', 'cards', 'results', 'items']) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as OptcgCard[];
    }
  }
  return null;
}

export class OptcgProvider implements CatalogProvider {
  readonly name = 'optcg';

  private async fetchCards(): Promise<OptcgCard[]> {
    const failures: string[] = [];

    for (const url of CARD_URLS) {
      try {
        const list = extractList(
          await requestJson<unknown>(url, {
            headers: { accept: 'application/json' },
            timeoutMs: 60_000,
            // Une adresse qui n'existe pas doit être écartée vite, pas réessayée.
            retries: 0,
          }),
        );
        if (list && list.length > 0) return list;
        failures.push(`${url} : réponse sans liste de cartes`);
      } catch (error) {
        failures.push(`${url} : ${error instanceof Error ? error.message.split('\n')[0] : error}`);
      }
    }

    throw new Error(
      `Aucune adresse optcgapi n'a répondu avec un catalogue.\n  ${failures.join('\n  ')}\n` +
        'Lance `npm run api:probe` pour voir ce que renvoie chaque source.',
    );
  }

  async fetchAll(): Promise<{ sets: Array<Omit<CardSet, 'cardCount'>>; cards: CatalogCard[] }> {
    const payload = await this.fetchCards();

    const cards: CatalogCard[] = [];
    const sets = new Map<string, Omit<CardSet, 'cardCount'>>();

    for (const raw of payload) {
      const rawId = (raw.card_set_id ?? '').trim();
      if (!rawId) continue;

      const code = baseCode(rawId);
      const setId = raw.set_id?.toUpperCase() || setIdFromCode(code);
      const setName = raw.set_name?.trim() || setId;

      cards.push({
        id: rawId.toUpperCase(),
        code,
        name: (raw.card_name ?? '').trim(),
        setId,
        setName,
        category: normalizeCategory(raw.card_type),
        rarity: raw.rarity?.trim() || null,
        colors: normalizeColors(raw.card_color),
        cost: parseNumber(raw.card_cost),
        power: parseNumber(raw.card_power),
        counter: parseNumber(raw.counter_amount),
        life: parseNumber(raw.life),
        attributes: splitList(raw.attribute),
        types: splitList(raw.sub_types),
        effect: raw.card_text?.trim() || null,
        trigger: raw.trigger?.trim() || null,
        imageUrl: raw.image_url ?? null,
        artVariant: parseArtVariant(rawId),
        language: 'EN',
      });

      if (!sets.has(setId)) {
        sets.set(setId, {
          id: setId,
          name: setName,
          kind: inferSetKind(setId, setName),
          code: setId,
          releaseDate: null,
          imageUrl: raw.image_url ?? null,
        });
      }
    }

    return { sets: [...sets.values()], cards };
  }
}
