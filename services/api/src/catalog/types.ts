import type { Card, CardSet } from '@op/shared';

export interface CatalogCard extends Omit<Card, 'setName' | 'setKind' | 'updatedAt'> {
  setName: string;
}

export interface CatalogProvider {
  readonly name: string;
  /** Renvoie la totalité du catalogue connu par la source. */
  fetchAll(): Promise<{ sets: Array<Omit<CardSet, 'cardCount'>>; cards: CatalogCard[] }>;
}
