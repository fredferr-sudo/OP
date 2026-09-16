import type { Card, Marketplace, PriceQuote } from '@op/shared';
import { config } from '../../config.js';
import { nowIso } from '../../db/index.js';
import type { MarketLink } from '../../db/repositories.js';
import { requestJson } from '../../lib/http.js';
import { searchQuery } from '../matching.js';
import type { PriceProvider, ProductMatch } from '../types.js';

/**
 * eBay — Browse API (annonces en cours).
 *
 * eBay n'a pas de notion de "produit" pour les cartes : on interroge donc par
 * requête texte et on agrège les annonces. Le prix de référence retenu est la
 * *médiane* et non la moyenne, parce que les annonces contiennent toujours
 * quelques lots et quelques cartes gradées qui écrasent une moyenne.
 *
 * Note : les ventes réellement conclues relèvent de l'API Marketplace Insights,
 * soumise à approbation eBay. Tant qu'elle n'est pas accordée, ce connecteur
 * reflète l'offre et non les transactions.
 */

interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  itemWebUrl?: string;
  buyingOptions?: string[];
}

interface EbaySearchResponse {
  total?: number;
  itemSummaries?: EbayItemSummary[];
}

/** Mots qui trahissent un lot, une carte gradée ou un proxy : à écarter du calcul. */
const EXCLUSION_PATTERN =
  /\b(lot|bundle|playset|x\s?\d{2,}|psa|bgs|cgc|graded|proxy|custom|orica|repack|booster box|display|sealed case)\b/i;

export class EbayProvider implements PriceProvider {
  readonly marketplace: Marketplace = 'ebay';

  private token: { value: string; expiresAt: number } | null = null;

  isConfigured(): boolean {
    return Boolean(config.ebay.clientId && config.ebay.clientSecret);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const basic = Buffer.from(
      `${config.ebay.clientId}:${config.ebay.clientSecret}`,
    ).toString('base64');

    const payload = await requestJson<{ access_token: string; expires_in: number }>(
      `${config.ebay.baseUrl}/identity/v1/oauth2/token`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: 'https://api.ebay.com/oauth/api_scope',
        }).toString(),
      },
    );

    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };
    return this.token.value;
  }

  private async search(query: string): Promise<EbayItemSummary[]> {
    const token = await this.accessToken();
    const params = new URLSearchParams({
      q: query,
      limit: '100',
      // Cartes à l'unité, en bon état, achat immédiat : la base la plus comparable.
      filter: 'buyingOptions:{FIXED_PRICE},conditions:{NEW|USED}',
      sort: 'price',
    });

    const payload = await requestJson<EbaySearchResponse>(
      `${config.ebay.baseUrl}/buy/browse/v1/item_summary/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': config.ebay.marketplaceId,
          accept: 'application/json',
        },
      },
    );

    return payload.itemSummaries ?? [];
  }

  async findProduct(card: Card): Promise<ProductMatch | null> {
    const query = searchQuery(card);
    const items = await this.search(query);

    // Pas d'identifiant produit chez eBay : la "correspondance" est la requête
    // elle-même, et sa qualité se mesure au nombre d'annonces exploitables.
    const usable = items.filter((item) => this.isUsable(card, item));

    return {
      externalId: null,
      externalName: null,
      query,
      url: `https://www.ebay.fr/sch/i.html?_nkw=${encodeURIComponent(query)}`,
      confidence: usable.length >= 3 ? 0.9 : usable.length > 0 ? 0.6 : 0.2,
    };
  }

  private isUsable(card: Card, item: EbayItemSummary): boolean {
    if (!item.price?.value) return false;
    if (EXCLUSION_PATTERN.test(item.title)) return false;
    // Le code de la carte doit apparaître : c'est le seul garde-fou fiable
    // contre les annonces d'autres cartes du même personnage.
    return item.title.toUpperCase().includes(card.code.toUpperCase());
  }

  async fetchQuote(card: Card, link: MarketLink): Promise<PriceQuote | null> {
    const query = link.query ?? searchQuery(card);
    const items = await this.search(query);

    const prices: number[] = [];
    let currency = 'EUR';

    for (const item of items) {
      if (!this.isUsable(card, item)) continue;
      const value = Number(item.price!.value);
      if (!Number.isFinite(value) || value <= 0) continue;
      prices.push(value);
      currency = item.price!.currency ?? currency;
    }

    if (prices.length === 0) return null;
    prices.sort((a, b) => a - b);

    return {
      cardId: card.id,
      marketplace: 'ebay',
      currency,
      low: prices[0],
      market: median(prices),
      avg1: null,
      avg7: null,
      avg30: null,
      listingCount: prices.length,
      foil: false,
      url: link.url,
      capturedAt: nowIso(),
    };
  }
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(value * 100) / 100;
}
