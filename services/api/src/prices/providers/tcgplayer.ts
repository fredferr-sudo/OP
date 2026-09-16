import type { Card, Marketplace, PriceQuote } from '@op/shared';
import { config } from '../../config.ts';
import { nowIso } from '../../db/index.ts';
import type { MarketLink } from '../../db/repositories.ts';
import { requestJson } from '../../lib/http.ts';
import { scoreMatch } from '../matching.ts';
import type { PriceProvider, ProductMatch } from '../types.ts';

/**
 * TCGplayer — API officielle.
 *
 * Authentification : OAuth2 client_credentials (clé publique + clé privée du
 * portail développeur). Le jeton est valable ~2 semaines, on le met en cache.
 */

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface TcgCategory {
  categoryId: number;
  name: string;
}

interface TcgProduct {
  productId: number;
  name: string;
  cleanName?: string;
  url?: string;
  groupId?: number;
  extendedData?: Array<{ name: string; value: string }>;
}

interface TcgGroup {
  groupId: number;
  name: string;
}

interface TcgPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: string; // "Normal" | "Foil"
}

interface TcgResponse<T> {
  success: boolean;
  errors: string[];
  results: T[];
}

export class TcgPlayerProvider implements PriceProvider {
  readonly marketplace: Marketplace = 'tcgplayer';

  private token: { value: string; expiresAt: number } | null = null;
  private categoryId: number | null = null;
  private groupsByName: Map<string, number> | null = null;

  isConfigured(): boolean {
    return Boolean(config.tcgplayer.publicKey && config.tcgplayer.privateKey);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.tcgplayer.publicKey,
      client_secret: config.tcgplayer.privateKey,
    });

    const payload = await requestJson<TokenResponse>(`${config.tcgplayer.baseUrl}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    };
    return this.token.value;
  }

  private async get<T>(path: string): Promise<TcgResponse<T>> {
    const token = await this.accessToken();
    return requestJson<TcgResponse<T>>(`${config.tcgplayer.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  }

  private async resolveCategoryId(): Promise<number> {
    if (this.categoryId !== null) return this.categoryId;

    const payload = await this.get<TcgCategory>('/catalog/categories?limit=100&offset=0');
    const match = payload.results.find((c) => /one piece/i.test(c.name));
    if (!match) {
      throw new Error("La catégorie 'One Piece Card Game' est introuvable chez TCGplayer.");
    }
    this.categoryId = match.categoryId;
    return match.categoryId;
  }

  /** Les "groups" de TCGplayer correspondent aux extensions du jeu. */
  private async resolveGroups(): Promise<Map<string, number>> {
    if (this.groupsByName) return this.groupsByName;

    const categoryId = await this.resolveCategoryId();
    const map = new Map<string, number>();
    let offset = 0;

    for (;;) {
      const payload = await this.get<TcgGroup>(
        `/catalog/groups?categoryId=${categoryId}&limit=100&offset=${offset}`,
      );
      for (const group of payload.results) map.set(group.name.toLowerCase(), group.groupId);
      if (payload.results.length < 100) break;
      offset += 100;
    }

    this.groupsByName = map;
    return map;
  }

  async findProduct(card: Card): Promise<ProductMatch | null> {
    const categoryId = await this.resolveCategoryId();

    // Restreindre au groupe (= extension) quand on le reconnaît réduit
    // drastiquement les faux positifs entre réimpressions.
    const groups = await this.resolveGroups();
    const groupId = groups.get(card.setName.toLowerCase());

    const params = new URLSearchParams({
      categoryId: String(categoryId),
      productName: card.name,
      getExtendedFields: 'true',
      limit: '50',
      offset: '0',
    });
    if (groupId) params.set('groupId', String(groupId));

    const payload = await this.get<TcgProduct>(`/catalog/products?${params.toString()}`);

    let best: { product: TcgProduct; score: number } | null = null;
    for (const product of payload.results) {
      const number = product.extendedData?.find((f) => f.name === 'Number')?.value ?? null;
      const score = scoreMatch(card, {
        name: product.cleanName ?? product.name,
        setName: card.setName,
        number,
      });
      if (!best || score > best.score) best = { product, score };
    }

    if (!best) return null;
    return {
      externalId: String(best.product.productId),
      externalName: best.product.name,
      query: null,
      url: best.product.url ?? null,
      confidence: best.score,
    };
  }

  async fetchQuote(card: Card, link: MarketLink): Promise<PriceQuote | null> {
    if (!link.externalId) return null;

    const payload = await this.get<TcgPrice>(`/pricing/product/${link.externalId}`);
    // On retient la variante normale ; les foils sont relevés séparément si besoin.
    const price =
      payload.results.find((p) => p.subTypeName === 'Normal') ?? payload.results[0];
    if (!price) return null;

    return {
      cardId: card.id,
      marketplace: 'tcgplayer',
      currency: 'USD',
      low: price.lowPrice ?? price.directLowPrice ?? null,
      market: price.marketPrice ?? price.midPrice ?? null,
      avg1: null,
      avg7: null,
      avg30: null,
      listingCount: null,
      foil: price.subTypeName === 'Foil',
      url: link.url,
      capturedAt: nowIso(),
    };
  }
}
