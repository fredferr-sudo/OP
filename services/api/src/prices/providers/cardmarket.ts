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

/** Une offre en vente sur la place de marché. */
interface CardmarketArticle {
  idArticle?: number;
  price?: number;
  priceEUR?: number;
  count?: number;
  condition?: string;
  isFoil?: boolean;
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

  /**
   * Médiane des premières offres dans l'état demandé.
   *
   * On part du chiffre qu'on lit sur la fiche produit après avoir filtré sur
   * l'état — ni la tendance, qui lisse le marché, ni le prix le plus bas toutes
   * conditions confondues, qui correspond souvent à un exemplaire abîmé.
   *
   * Retenir la seule offre la moins chère rendrait le suivi nerveux : une carte
   * mal tarifée, un vendeur qui solde, et la valeur de la collection décroche
   * pour la journée. La médiane des trois premières absorbe ce cas sans s'éloigner
   * du prix auquel on achète réellement.
   *
   * Les offres ne sont pas garanties triées par prix : on les trie nous-mêmes.
   */
  private async lowestListing(productId: string, foil: boolean): Promise<number | null> {
    const params = new URLSearchParams({
      start: '0',
      maxResults: String(config.cardmarket.articleSample),
      minCondition: config.cardmarket.minCondition,
      isFoil: foil ? 'true' : 'false',
      // Un lot de plusieurs exemplaires afficherait un prix unitaire trompeur.
      isPlayset: 'false',
    });
    if (config.cardmarket.languageId) params.set('idLanguage', config.cardmarket.languageId);

    const payload = await this.get<{ article?: CardmarketArticle[] }>(
      `/articles/${productId}?${params.toString()}`,
    );

    const prices: number[] = [];
    for (const article of payload.article ?? []) {
      const value = article.price ?? article.priceEUR;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
      prices.push(value);
    }
    if (prices.length === 0) return null;

    prices.sort((a, b) => a - b);
    return median(prices.slice(0, Math.max(1, config.cardmarket.priceSample)));
  }

  async fetchQuote(card: Card, link: MarketLink): Promise<PriceQuote | null> {
    if (!link.externalId) return null;

    const payload = await this.get<{ product?: CardmarketProduct }>(
      `/products/${link.externalId}`,
    );
    const guide = payload.product?.priceGuide;
    if (!guide) return null;

    // Le guide reste nécessaire : ses moyennes glissantes alimentent la
    // reconstruction de l'historique sur trente jours.
    let reference: number | null = null;
    try {
      reference = await this.lowestListing(link.externalId, false);
    } catch (error) {
      // Une offre introuvable ne doit pas faire perdre le relevé du jour.
      console.warn(
        `[cardmarket] offres indisponibles pour ${card.code}, repli sur le guide :`,
        error instanceof Error ? error.message.split('\n')[0] : error,
      );
    }

    return {
      cardId: card.id,
      marketplace: 'cardmarket',
      currency: 'EUR',
      low: guide.LOW ?? null,
      // Première offre dans l'état demandé ; à défaut, le plus bas prix en bon
      // état du guide, puis la tendance.
      market: reference ?? guide.LOWEX ?? guide.TREND ?? guide.AVG ?? null,
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

/** Médiane d'une série déjà triée. */
function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return Math.round(value * 100) / 100;
}

/** encodeURIComponent n'échappe pas ! * ' ( ), que OAuth 1.0a exige d'échapper. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
