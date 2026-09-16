import type { CardSet } from '@op/shared';
import { config } from '../../config.js';
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
 * apitcg.com — API communautaire couvrant l'intégralité du One Piece Card Game
 * (extensions, decks de structure, promos), avec les visuels officiels.
 * Nécessite une clé gratuite, passée en en-tête `x-api-key`.
 */

interface ApiTcgCard {
  id: string;
  code: string;
  name: string;
  rarity?: string;
  type?: string;
  cost?: number | string;
  power?: number | string;
  counter?: number | string;
  life?: number | string;
  color?: string;
  family?: string;
  ability?: string;
  trigger?: string;
  attribute?: { name?: string };
  images?: { small?: string; large?: string };
  set?: { id?: string; name?: string };
}

interface ApiTcgPage {
  data: ApiTcgCard[];
  page?: number;
  limit?: number;
  totalPages?: number;
  total?: number;
}

const BASE_URL = 'https://apitcg.com/api/one-piece/cards';
const PAGE_SIZE = 100;

export class ApiTcgProvider implements CatalogProvider {
  readonly name = 'apitcg';

  constructor(private readonly apiKey: string = config.catalog.apitcgKey) {
    if (!apiKey) {
      throw new Error(
        'APITCG_KEY manquante. Renseigne-la dans .env, ou passe CATALOG_PROVIDER=local.',
      );
    }
  }

  async fetchAll(): Promise<{ sets: Array<Omit<CardSet, 'cardCount'>>; cards: CatalogCard[] }> {
    const cards: CatalogCard[] = [];
    const sets = new Map<string, Omit<CardSet, 'cardCount'>>();

    let page = 1;
    let totalPages = 1;

    do {
      const url = `${BASE_URL}?limit=${PAGE_SIZE}&page=${page}`;
      const payload = await requestJson<ApiTcgPage>(url, {
        headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
      });

      totalPages = payload.totalPages ?? Math.ceil((payload.total ?? 0) / PAGE_SIZE) ?? 1;

      for (const raw of payload.data ?? []) {
        const card = this.toCard(raw);
        if (!card) continue;
        cards.push(card);

        if (!sets.has(card.setId)) {
          sets.set(card.setId, {
            id: card.setId,
            name: card.setName,
            kind: inferSetKind(card.setId, card.setName),
            code: card.setId,
            releaseDate: null,
            imageUrl: card.imageUrl,
          });
        }
      }
      page += 1;
    } while (page <= totalPages);

    return { sets: [...sets.values()], cards };
  }

  private toCard(raw: ApiTcgCard): CatalogCard | null {
    const code = baseCode(raw.code ?? raw.id ?? '');
    if (!code) return null;

    const setId = raw.set?.id?.toUpperCase() || setIdFromCode(code);
    const setName = raw.set?.name?.trim() || setId;

    return {
      id: (raw.id ?? raw.code).toUpperCase(),
      code,
      name: (raw.name ?? '').trim(),
      setId,
      setName,
      category: normalizeCategory(raw.type),
      rarity: raw.rarity?.trim() || null,
      colors: normalizeColors(raw.color),
      cost: parseNumber(raw.cost),
      power: parseNumber(raw.power),
      counter: parseNumber(raw.counter),
      life: parseNumber(raw.life),
      attributes: splitList(raw.attribute?.name),
      types: splitList(raw.family),
      effect: raw.ability?.trim() || null,
      trigger: raw.trigger?.trim() || null,
      imageUrl: raw.images?.large ?? raw.images?.small ?? null,
      artVariant: parseArtVariant(raw.id ?? ''),
      language: 'EN',
    };
  }
}
