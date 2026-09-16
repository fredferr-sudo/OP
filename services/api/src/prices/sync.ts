import type { Card, Marketplace } from '@op/shared';
import { today } from '../db/index.ts';
import {
  cardsToPrice,
  finishSyncRun,
  getCard,
  getMarketLink,
  insertSnapshot,
  saveMarketLink,
  startSyncRun,
  type MarketLink,
} from '../db/repositories.ts';
import { backfillFromAverages } from './backfill.ts';
import { CardmarketProvider } from './providers/cardmarket.ts';
import { EbayProvider } from './providers/ebay.ts';
import { TcgPlayerProvider } from './providers/tcgplayer.ts';
import { MIN_CONFIDENCE, type PriceProvider } from './types.ts';

let providers: PriceProvider[] | null = null;

export function priceProviders(): PriceProvider[] {
  if (!providers) {
    providers = [new CardmarketProvider(), new TcgPlayerProvider(), new EbayProvider()];
  }
  return providers;
}

export function configuredProviders(): PriceProvider[] {
  return priceProviders().filter((p) => p.isConfigured());
}

export function providerStatus(): Array<{ marketplace: Marketplace; configured: boolean }> {
  return priceProviders().map((p) => ({
    marketplace: p.marketplace,
    configured: p.isConfigured(),
  }));
}

/**
 * Relève le prix d'une carte chez un fournisseur, en créant au besoin la
 * correspondance carte <-> produit.
 */
export async function refreshCardPrice(
  card: Card,
  provider: PriceProvider,
): Promise<'ok' | 'no-match' | 'no-price'> {
  let link: MarketLink | null = getMarketLink(card.id, provider.marketplace);

  if (!link || link.confidence < MIN_CONFIDENCE) {
    const match = await provider.findProduct(card);
    if (!match) return 'no-match';

    link = {
      cardId: card.id,
      marketplace: provider.marketplace,
      externalId: match.externalId,
      externalName: match.externalName,
      query: match.query,
      url: match.url,
      confidence: match.confidence,
    };
    saveMarketLink(link);

    if (link.confidence < MIN_CONFIDENCE) return 'no-match';
  }

  const quote = await provider.fetchQuote(card, link);
  if (!quote) return 'no-price';

  const capturedOn = today();
  insertSnapshot({ ...quote, capturedOn, estimated: false });

  // Premier relevé pour cette carte : on reconstitue le mois écoulé à partir
  // des moyennes glissantes, pour que le graphique soit lisible immédiatement.
  const backfill = backfillFromAverages(quote);
  for (const point of backfill) {
    if (point.date === capturedOn) continue;
    insertSnapshot({
      ...quote,
      capturedOn: point.date,
      market: point.value,
      low: null,
      listingCount: null,
      estimated: true,
    });
  }

  return 'ok';
}

export interface PriceSyncResult {
  processed: number;
  failed: number;
  byMarketplace: Record<string, number>;
}

/**
 * Relève quotidien. `limit` borne le nombre de cartes traitées par passage,
 * pour rester dans les quotas journaliers des APIs (Cardmarket ~5000 requêtes/jour).
 */
export async function syncPrices(options: { limit?: number; cardIds?: string[] } = {}): Promise<
  PriceSyncResult
> {
  const active = configuredProviders();
  const runId = startSyncRun('prices', active.map((p) => p.marketplace).join(',') || 'none');

  const result: PriceSyncResult = { processed: 0, failed: 0, byMarketplace: {} };

  if (active.length === 0) {
    finishSyncRun(
      runId,
      'success',
      0,
      0,
      'Aucune source de prix configurée (voir .env). Relevé ignoré.',
    );
    return result;
  }

  const cardIds = options.cardIds ?? cardsToPrice(options.limit ?? 500);

  try {
    for (const cardId of cardIds) {
      const card = getCard(cardId);
      if (!card) continue;

      for (const provider of active) {
        try {
          const outcome = await refreshCardPrice(card, provider);
          if (outcome === 'ok') {
            result.byMarketplace[provider.marketplace] =
              (result.byMarketplace[provider.marketplace] ?? 0) + 1;
          }
        } catch (error) {
          // Une source qui tombe ne doit pas empêcher les deux autres d'être relevées.
          result.failed += 1;
          console.warn(
            `[prices] ${provider.marketplace} a échoué pour ${card.code}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
      result.processed += 1;
    }

    finishSyncRun(runId, 'success', result.processed, result.failed);
    return result;
  } catch (error) {
    finishSyncRun(
      runId,
      'error',
      result.processed,
      result.failed,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
