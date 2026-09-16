import type { Card, Marketplace, PriceQuote } from '@op/shared';
import { createHmac, randomBytes } from 'node:crypto';
import { config } from '../../config.ts';
import { nowIso } from '../../db/index.ts';
import type { MarketLink } from '../../db/repositories.ts';
import { requestJson } from '../../lib/http.ts';
import { scoreMatch } from '../matching.ts';
import type { PriceProvider, ProductMatch } from '../types.ts';

/**
 * Cardmarket — API officielle v2.0.
 *
 * Authentification : OAuth 1.0a en mode "2-legged" (pas de redirection utilisateur),
 * signature HMAC-SHA1 dans l'en-tête Authorization. Les quatre jetons se créent
 * depuis le compte Cardmarket (Account > API).
 *
 * C'est la seule des trois sources qui expose des moyennes glissantes
 * (AVG1 / AVG7 / AVG30) : elles servent à reconstruire un historique sur 30 jours
 * dès le premier relevé, avant que les relevés quotidiens ne prennent le relais.
 */

interface CardmarketPriceGuide {
  SELL?: number;
  LOW?: number;
  LOWEX?: number;
  LOWFOIL?: number;
  AVG?: number;
  TREND?: number;
  AVG1?: number;
  AVG7?: number;
  AVG30?: number;
  FOILLOW?: number;
  FOILTREND?: number;
  FOILAVG1?: number;
  FOILAVG7?: number;
  FOILAVG30?: number;
}

interface CardmarketProduct {
  idProduct: number;
  enName?: string;
  locName?: string;
  number?: string;
  website?: string;
  expansionName?: string;
  countArticles?: number;
  priceGuide?: CardmarketPriceGuide;
}

interface CardmarketGame {
  idGame: number;
  name: string;
}

export class CardmarketProvider implements PriceProvider {
  readonly marketplace: Marketplace = 'cardmarket';

  private gameId: number | null = null;

  isConfigured(): boolean {
    const c = config.cardmarket;
    return Boolean(c.appToken && c.appSecret && c.accessToken && c.accessSecret);
  }

  /**
   * Signature OAuth 1.0a. Cardmarket signe l'URL *sans* les paramètres de requête
   * dans l'URL de base, mais *avec* eux dans la chaîne de paramètres.
   */
  private authHeader(method: string, url: string): string {
    const c = config.cardmarket;
    const parsed = new URL(url);
    const baseUrl = `${parsed.origin}${parsed.pathname}`;

    const oauth: Record<string, string> = {
      oauth_consumer_key: c.appToken,
      oauth_token: c.accessToken,
      oauth_nonce: randomBytes(16).toString('hex'),
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_version: '1.0',
    };

    const allParams: Record<string, string> = { ...oauth };
    parsed.searchParams.forEach((value, key) => {
      allParams[key] = value;
    });

    const paramString = Object.keys(allParams)
      .sort()
      .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(allParams[key])}`)
      .join('&');

    const signatureBase = [
      method.toUpperCase(),
      encodeRfc3986(baseUrl),
      encodeRfc3986(paramString),
    ].join('&');

    const signingKey = `${encodeRfc3986(c.appSecret)}&${encodeRfc3986(c.accessSecret)}`;
    const signature = createHmac('sha1', signingKey).update(signatureBase).digest('base64');

    const headerParams = { ...oauth, realm: baseUrl, oauth_signature: signature };
    return `OAuth ${Object.entries(headerParams)
      .map(([key, value]) => `${encodeRfc3986(key)}="${encodeRfc3986(value)}"`)
      .join(', ')}`;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${config.cardmarket.baseUrl}${path}`;
    return requestJson<T>(url, {
      headers: {
        Authorization: this.authHeader('GET', url),
        accept: 'application/json',
      },
    });
  }

  /** Cardmarket attribue un identifiant à chaque jeu ; on le résout par son nom. */
  private async resolveGameId(): Promise<number> {
    if (this.gameId !== null) return this.gameId;

    const payload = await this.get<{ game: CardmarketGame[] }>('/games');
    const games = payload.game ?? [];
    const match = games.find((g) => /one piece/i.test(g.name));
    if (!match) {
      throw new Error("Le jeu 'One Piece Card Game' est introuvable dans /games chez Cardmarket.");
    }
    this.gameId = match.idGame;
    return match.idGame;
  }

  async findProduct(card: Card): Promise<ProductMatch | null> {
    const gameId = await this.resolveGameId();
    const search = encodeURIComponent(card.name);
    const payload = await this.get<{ product?: CardmarketProduct[] }>(
      `/products/find?search=${search}&idGame=${gameId}&idLanguage=1&exact=false&start=0&maxResults=50`,
    );

    const candidates = payload.product ?? [];
    let best: { product: CardmarketProduct; score: number } | null = null;

    for (const product of candidates) {
      const score = scoreMatch(card, {
        name: product.enName ?? product.locName ?? '',
        setName: product.expansionName,
        number: product.number,
      });
      if (!best || score > best.score) best = { product, score };
    }

    if (!best) return null;
    return {
      externalId: String(best.product.idProduct),
      externalName: best.product.enName ?? best.product.locName ?? null,
      query: null,
      url: best.product.website
        ? `https://www.cardmarket.com${best.product.website}`
        : null,
      confidence: best.score,
    };
  }

  async fetchQuote(card: Card, link: MarketLink): Promise<PriceQuote | null> {
    if (!link.externalId) return null;

    const payload = await this.get<{ product?: CardmarketProduct }>(
      `/products/${link.externalId}`,
    );
    const guide = payload.product?.priceGuide;
    if (!guide) return null;

    return {
      cardId: card.id,
      marketplace: 'cardmarket',
      currency: 'EUR',
      low: guide.LOW ?? guide.LOWEX ?? null,
      market: guide.TREND ?? guide.AVG ?? null,
      avg1: guide.AVG1 ?? null,
      avg7: guide.AVG7 ?? null,
      avg30: guide.AVG30 ?? null,
      listingCount: payload.product?.countArticles ?? null,
      foil: false,
      url: link.url,
      capturedAt: nowIso(),
    };
  }
}

/** encodeURIComponent n'échappe pas ! * ' ( ), que OAuth 1.0a exige d'échapper. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
