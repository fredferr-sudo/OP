import type { Card, CardSet, Marketplace } from '@op/shared';

export interface CatalogCard extends Omit<Card, 'setName' | 'setKind' | 'updatedAt'> {
  setName: string;
}

/**
 * Correspondance carte ↔ produit d'une marketplace, telle que fournie par la
 * source du catalogue. Bien plus fiable qu'un rapprochement par nom, qu'elle
 * rend inutile quand elle est disponible.
 */
export interface CatalogLink {
  cardId: string;
  marketplace: Marketplace;
  externalId: string;
  url: string | null;
}

/** Prix courant fourni par la source du catalogue elle-même. */
export interface CatalogQuote {
  cardId: string;
  marketplace: Marketplace;
  currency: string;
  market: number;
  foil: boolean;
}

export interface CatalogPayload {
  sets: Array<Omit<CardSet, 'cardCount'>>;
  cards: CatalogCard[];
  links?: CatalogLink[];
  quotes?: CatalogQuote[];
}

export interface CatalogProvider {
  readonly name: string;
  /** Renvoie la totalité du catalogue connu par la source. */
  fetchAll(): Promise<CatalogPayload>;
}
