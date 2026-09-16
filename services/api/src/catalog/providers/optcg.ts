import type { CardSet } from '@op/shared';
import { requestJson } from '../../lib/http.js';
import {
  baseCode,
  inferSetKind,
  normalizeCategory,
  normalizeColors,
  parseArtVariant,
  parseNumber,
  setIdFromCode,
  splitList,
} from '../classify.js';
import type { CatalogCard, CatalogProvider } from '../types.js';

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

const ALL_CARDS_URL = 'https://optcgapi.com/api/allCards/';

export class OptcgProvider implements CatalogProvider {
  readonly name = 'optcg';

  async fetchAll(): Promise<{ sets: Array<Omit<CardSet, 'cardCount'>>; cards: CatalogCard[] }> {
    const payload = await requestJson<OptcgCard[]>(ALL_CARDS_URL, {
      headers: { accept: 'application/json' },
      timeoutMs: 60_000,
    });

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
