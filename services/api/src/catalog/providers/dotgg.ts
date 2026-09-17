import type { CardSet, Marketplace } from '@op/shared';
import { config } from '../../config.ts';
import { requestJson } from '../../lib/http.ts';
import {
  inferSetKind,
  isJapanese,
  normalizeCategory,
  normalizeColors,
  normalizeSetId,
  parseCardSets,
  parseNumber,
  splitList,
} from '../classify.ts';
import { fetchSetNames } from '../set-names.ts';
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

/**
 * Retient le meilleur nom pour un produit, parmi ceux croisés sur ses cartes.
 *
 * Un nom latin l'emporte sur un nom japonais : le catalogue est consulté en
 * français, et « ROMANCE DAWN » est lisible là où « プレミアムカードコレクション »
 * ne l'est pas. À égalité, le premier rencontré suffit.
 */
function betterName(current: string | undefined, candidate: string): string {
  if (!candidate) return current ?? '';
  if (!current) return candidate;
  if (isJapanese(current) && !isJapanese(candidate)) return candidate;
  return current;
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

    // Noms anglais canoniques, quand ils sont disponibles : ils priment sur tout.
    const officialNames = await fetchSetNames();

    const cards: CatalogCard[] = [];
    const setNames = new Map<string, string>();
    const setOrder: string[] = [];
    const links: CatalogPayload['links'] = [];
    const quotes: CatalogPayload['quotes'] = [];

    for (const raw of list) {
      // La casse d'origine sert aux visuels : les illustrations alternatives sont
      // publiées en « OP01-016_p1.png », un « _P1 » majuscule ne résout pas.
      const rawId = (raw.id ?? '').trim();
      const id = rawId.toUpperCase();
      if (!id) continue;

      const idNormal = (raw.id_normal ?? id).trim().toUpperCase();
      const setId = normalizeSetId((raw.set ?? '').trim() || idNormal.split('-')[0]);

      // `CardSets` liste tous les produits où la carte figure ; seul celui dont le
      // code correspond à son extension nomme cette extension. Prendre le premier
      // venu attribuait à OP01 le nom d'une collection premium.
      const entries = parseCardSets(raw.CardSets);
      const entry =
        entries.find((candidate) => candidate.code === setId) ??
        // Produits dérivés (pré-sorties, coffrets démo) dont le code ne figure pas
        // tel quel : un nom approchant reste préférable à un code brut à l'écran.
        entries.find(
          (candidate) => candidate.code.startsWith(setId) || setId.startsWith(candidate.code),
        ) ??
        entries[0];
      const setName = entry?.name ?? setId;

      if (!setNames.has(setId)) setOrder.push(setId);
      setNames.set(setId, betterName(setNames.get(setId), setName));

      cards.push({
        id,
        code: idNormal,
        name: (raw.name ?? '').trim(),
        setId,
        // Renseigné définitivement après la boucle, une fois tous les noms vus.
        setName: setId,
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

    // Résolution finale des noms : le dictionnaire anglais l'emporte, sinon le
    // meilleur nom croisé sur les cartes du produit, sinon son code.
    const resolved = new Map<string, string>();
    for (const setId of setOrder) {
      const fromDirectory = officialNames.get(setId);
      const fromCards = setNames.get(setId);
      resolved.set(setId, fromDirectory || fromCards || setId);
    }

    for (const card of cards) {
      card.setName = resolved.get(card.setId) ?? card.setId;
    }

    const sets = setOrder.map((setId) => {
      const name = resolved.get(setId) ?? setId;
      return {
        id: setId,
        name,
        kind: inferSetKind(setId, name),
        code: setId,
        releaseDate: null,
        imageUrl: null,
      };
    });

    return { sets, cards, links, quotes };
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
