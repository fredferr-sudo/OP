import { existsSync, readFileSync } from 'node:fs';
import type { CardSet } from '@op/shared';
import { config } from '../config.ts';
import { inferSetKind, normalizeCategory, normalizeColors, parseNumber, splitList } from './classify.ts';
import type { CatalogCard, CatalogPayload } from './types.ts';

/**
 * Complément local du catalogue.
 *
 * Les sources internationales ignorent les exclusivités régionales — une promo
 * distribuée lors d'un événement français, par exemple, n'existe dans aucune
 * d'elles. Plutôt que de chercher indéfiniment une source qui couvrirait tout,
 * ce fichier permet d'ajouter ces cartes à la main. Il est fusionné après la
 * source principale, donc il complète et corrige sans jamais être écrasé.
 */

interface SupplementFile {
  sets?: Array<{
    id: string;
    name: string;
    kind?: CardSet['kind'];
    releaseDate?: string | null;
  }>;
  cards?: Array<{
    id: string;
    code?: string;
    name: string;
    setId: string;
    category?: string;
    rarity?: string | null;
    colors?: string | string[];
    cost?: number | string | null;
    power?: number | string | null;
    counter?: number | string | null;
    life?: number | string | null;
    attributes?: string | string[];
    types?: string | string[];
    effect?: string | null;
    trigger?: string | null;
    imageUrl?: string | null;
    artVariant?: number;
    language?: string;
    /** Identifiant produit Cardmarket, quand on le connaît : il évite tout
     *  rapprochement par nom au moment de relever le prix. */
    cardmarketId?: string | number | null;
    cardmarketUrl?: string | null;
    /** Recherche eBay à utiliser pour coter la carte.
     *  Pour une promo d'événement, c'est souvent la seule cotation qui existe :
     *  elle n'a ni fiche Cardmarket ni fiche TCGplayer, mais elle se revend. */
    ebayQuery?: string | null;
  }>;
}

export function supplementPath(): string {
  return config.catalog.supplementPath;
}

export function loadSupplement(): CatalogPayload | null {
  const path = supplementPath();
  if (!existsSync(path)) return null;

  let parsed: SupplementFile;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as SupplementFile;
  } catch (error) {
    throw new Error(
      `Complément illisible (${path}) : ${error instanceof Error ? error.message : error}`,
    );
  }

  const sets = (parsed.sets ?? []).map((set) => ({
    id: set.id.trim().toUpperCase(),
    name: set.name.trim(),
    kind: set.kind ?? inferSetKind(set.id, set.name),
    code: set.id.trim().toUpperCase(),
    releaseDate: set.releaseDate ?? null,
    imageUrl: null,
  }));

  const setNames = new Map(sets.map((set) => [set.id, set.name]));

  const cards: CatalogCard[] = (parsed.cards ?? []).map((card) => {
    const id = card.id.trim().toUpperCase();
    const setId = card.setId.trim().toUpperCase();
    return {
      id,
      code: (card.code ?? id).trim().toUpperCase().replace(/_P\d+$/i, ''),
      name: card.name.trim(),
      setId,
      setName: setNames.get(setId) ?? setId,
      category: normalizeCategory(card.category),
      rarity: card.rarity ?? null,
      colors: normalizeColors(card.colors),
      cost: parseNumber(card.cost),
      power: parseNumber(card.power),
      counter: parseNumber(card.counter),
      life: parseNumber(card.life),
      attributes: splitList(card.attributes),
      types: splitList(card.types),
      effect: card.effect ?? null,
      trigger: card.trigger ?? null,
      imageUrl: card.imageUrl ?? null,
      artVariant: card.artVariant ?? 0,
      language: (card.language ?? 'EN').toUpperCase() as CatalogCard['language'],
    };
  });

  // Un identifiant produit fourni à la main vaut mieux qu'un rapprochement par
  // nom : on l'enregistre comme correspondance certaine.
  const links: CatalogPayload['links'] = [];
  for (const card of parsed.cards ?? []) {
    const cardId = card.id.trim().toUpperCase();
    if (card.cardmarketId) {
      links.push({
        cardId,
        marketplace: 'cardmarket',
        externalId: String(card.cardmarketId),
        url: card.cardmarketUrl ?? null,
      });
    }
    // eBay n'a pas de fiche produit : c'est la requête qui identifie la carte,
    // et pour une promo d'événement elle vaut souvent mieux qu'un identifiant
    // Cardmarket qui n'existe pas.
    if (card.ebayQuery) {
      links.push({
        cardId,
        marketplace: 'ebay',
        externalId: null,
        query: card.ebayQuery.trim(),
        url: null,
      });
    }
  }

  if (sets.length === 0 && cards.length === 0) return null;
  return { sets, cards, links };
}
