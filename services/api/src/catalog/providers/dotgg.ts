import type { CardSet, Marketplace } from '@op/shared';
import { config } from '../../config.ts';
import { requestJson } from '../../lib/http.ts';
import {
  inferSetKind,
  normalizeCategory,
  normalizeColors,
  parseNumber,
  splitList,
} from '../classify.ts';
import type { CatalogCard, CatalogPayload, CatalogProvider } from '../types.ts';

/**
 * dotgg — source principale du catalogue.
 *
 * Elle rend l'intégralité du jeu en un seul appel, sans clé. Surtout, chaque carte
 * y porte déjà son identifiant produit chez Cardmarket (`cmid`) et chez TCGplayer
 * (`marketIds`), ainsi que leurs prix courants. C'est décisif : associer une carte
 * à son produit est le point le plus fragile d'un suivi de prix, et cette source
 * nous donne la correspondance exacte au lieu d'un rapprochement par nom.
 */

interface DotggCard {
  id?: string;
  id_normal?: string;
  rarity?: string;
  cardType?: string;
  name?: string;
  Cost?: number | string | null;
  Attribute?: string | null;
  Power?: number | string | null;
  Counter?: number | string | null;
  Color?: string | null;
  Type?: string | null;
  Effect?: string | null;
  CardSets?: string | null;
  Life?: number | string | null;
  Trigger?: string | null;
  slug?: string;
  set?: string;
  language?: string;

  // Données marchandes
  price?: number | string | null; // TCGplayer, USD
  foilPrice?: number | string | null;
  marketIds?: string | number | null; // identifiant produit TCGplayer
  cmurl?: string | null;
  cmid?: string | number | null; // identifiant produit Cardmarket
  cmPrice?: number | string | null; // Cardmarket, EUR
  cmFoilPrice?: number | string | null;
}

/** Visuel officiel Bandai, nommé d'après l'identifiant de la carte. */
function officialImageUrl(cardId: string): string {
  return `https://en.onepiece-cardgame.com/images/cardlist/card/${cardId}.png`;
}

/** "-Memorial Collection- [EB-01]" -> "Memorial Collection" */
function cleanSetName(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const withoutCode = raw.replace(/\[[^\]]*\]/g, '');
  const cleaned = withoutCode.replace(/^[\s-]+|[\s-]+$/g, '').trim();
  return cleaned || fallback;
}

/**
 * Numéro d'illustration alternative.
 * La source distingue `id` (illustration précise) de `id_normal` (carte de base) :
 * quand les deux diffèrent, le suffixe porte le numéro.
 */
function artVariantOf(id: string, idNormal: string): number {
  if (!idNormal || id === idNormal) {
    const match = /_p(\d+)$/i.exec(id);
    return match ? Number(match[1]) : 0;
  }
  const match = /_p(\d+)$/i.exec(id);
  if (match) return Number(match[1]);
  // Identifiants différents sans suffixe reconnaissable : c'est tout de même
  // une autre illustration, on la distingue par 1.
  return 1;
}

/** Les identifiants produit arrivent parfois sous forme de liste. */
function firstId(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const first = String(raw).split(/[,;\s]+/).filter(Boolean)[0];
  return first ?? null;
}

function price(raw: number | string | null | undefined): number | null {
  const value = parseNumber(raw);
  // Les prix absents sont transmis comme 0 : les retenir fausserait la collection.
  return value !== null && value > 0 ? value : null;
}

export class DotggProvider implements CatalogProvider {
  readonly name = 'dotgg';

  async fetchAll(): Promise<CatalogPayload> {
    const payload = await requestJson<DotggCard[] | { data?: DotggCard[] }>(config.catalog.dotggUrl, {
      headers: { accept: 'application/json' },
      timeoutMs: 60_000,
    });

    const list = Array.isArray(payload) ? payload : (payload.data ?? []);
    if (list.length === 0) {
      throw new Error("dotgg a répondu, mais sans aucune carte.");
    }

    const cards: CatalogCard[] = [];
    const sets = new Map<string, Omit<CardSet, 'cardCount'>>();
    const links: CatalogPayload['links'] = [];
    const quotes: CatalogPayload['quotes'] = [];

    for (const raw of list) {
      // La casse d'origine sert aux visuels : les illustrations alternatives sont
      // publiées en « OP01-016_p1.png », un « _P1 » majuscule ne résout pas.
      const rawId = (raw.id ?? '').trim();
      const id = rawId.toUpperCase();
      if (!id) continue;

      const idNormal = (raw.id_normal ?? id).trim().toUpperCase();
      const setId = (raw.set ?? '').trim().toUpperCase() || idNormal.split('-')[0];
      const setName = cleanSetName(raw.CardSets, setId);

      cards.push({
        id,
        code: idNormal,
        name: (raw.name ?? '').trim(),
        setId,
        setName,
        category: normalizeCategory(raw.cardType),
        rarity: raw.rarity?.trim() || null,
        colors: normalizeColors(raw.Color),
        cost: parseNumber(raw.Cost),
        power: parseNumber(raw.Power),
        counter: parseNumber(raw.Counter),
        life: parseNumber(raw.Life),
        attributes: splitList(raw.Attribute),
        types: splitList(raw.Type),
        effect: raw.Effect?.trim() || null,
        trigger: raw.Trigger?.trim() || null,
        imageUrl: officialImageUrl(rawId),
        artVariant: artVariantOf(id, idNormal),
        language: (raw.language ?? 'en').toUpperCase() as CatalogCard['language'],
      });

      if (!sets.has(setId)) {
        sets.set(setId, {
          id: setId,
          name: setName,
          kind: inferSetKind(setId, setName),
          code: setId,
          releaseDate: null,
          imageUrl: null,
        });
      }

      // --- Correspondances marketplace, fournies directement par la source.
      const cardmarketId = firstId(raw.cmid);
      if (cardmarketId) {
        links.push({
          cardId: id,
          marketplace: 'cardmarket',
          externalId: cardmarketId,
          url: raw.cmurl ?? null,
        });
      }

      const tcgplayerId = firstId(raw.marketIds);
      if (tcgplayerId) {
        links.push({
          cardId: id,
          marketplace: 'tcgplayer',
          externalId: tcgplayerId,
          url: `https://www.tcgplayer.com/product/${tcgplayerId}`,
        });
      }

      // --- Prix courants. Ils permettent à l'app d'afficher des cotations dès la
      //     première synchronisation, sans aucune clé d'API.
      pushQuote(quotes, id, 'cardmarket', 'EUR', price(raw.cmPrice), false);
      pushQuote(quotes, id, 'cardmarket', 'EUR', price(raw.cmFoilPrice), true);
      pushQuote(quotes, id, 'tcgplayer', 'USD', price(raw.price), false);
      pushQuote(quotes, id, 'tcgplayer', 'USD', price(raw.foilPrice), true);
    }

    return { sets: [...sets.values()], cards, links, quotes };
  }
}

function pushQuote(
  quotes: NonNullable<CatalogPayload['quotes']>,
  cardId: string,
  marketplace: Marketplace,
  currency: string,
  value: number | null,
  foil: boolean,
): void {
  if (value === null) return;
  quotes.push({ cardId, marketplace, currency, market: value, foil });
}
