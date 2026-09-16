import type { Card, Marketplace, PriceQuote } from '@op/shared';
import type { MarketLink } from '../db/repositories.ts';

export interface ProductMatch {
  externalId: string | null;
  externalName: string | null;
  query: string | null;
  url: string | null;
  /** 0 → 1. En dessous de MIN_CONFIDENCE, on ne relève pas de prix. */
  confidence: number;
}

export interface PriceProvider {
  readonly marketplace: Marketplace;
  /** false quand les clés ne sont pas renseignées : la source est simplement ignorée. */
  isConfigured(): boolean;
  /** Retrouve le produit correspondant à la carte chez la marketplace. */
  findProduct(card: Card): Promise<ProductMatch | null>;
  /** Relève le prix courant. */
  fetchQuote(card: Card, link: MarketLink): Promise<PriceQuote | null>;
}

/** En deçà, la correspondance est jugée trop incertaine pour être exploitée. */
export const MIN_CONFIDENCE = 0.55;
