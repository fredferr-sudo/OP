import { config } from '../config.ts';
import { nowIso, today, transaction } from '../db/index.ts';
import {
  finishSyncRun,
  insertSnapshot,
  saveMarketLink,
  startSyncRun,
  upsertCard,
  upsertSet,
} from '../db/repositories.ts';
import { inferSetKind } from './classify.ts';
import { ApiTcgProvider } from './providers/apitcg.ts';
import { DotggProvider } from './providers/dotgg.ts';
import { LocalProvider } from './providers/local.ts';
import { loadSupplement, supplementPath } from './supplement.ts';
import type { CatalogProvider } from './types.ts';

export function createCatalogProvider(): CatalogProvider {
  return providerChain()[0];
}

/**
 * Sources à essayer, dans l'ordre de préférence.
 *
 * Les sources distantes peuvent tomber ou changer d'adresse ; le catalogue local
 * ferme toujours la marche, pour qu'une synchronisation ne laisse jamais l'app
 * sans rien à afficher. La bascule est signalée explicitement, jamais silencieuse.
 */
export function providerChain(): CatalogProvider[] {
  switch (config.catalog.provider) {
    case 'local':
      return [new LocalProvider()];
    case 'apitcg':
      // Sans clé, apitcg est inutilisable : on ne la met dans la chaîne que si
      // elle a de quoi s'authentifier.
      return config.catalog.apitcgKey
        ? [new ApiTcgProvider(), new DotggProvider(), new LocalProvider()]
        : [new DotggProvider(), new LocalProvider()];
    case 'dotgg':
    default:
      return [new DotggProvider(), new LocalProvider()];
  }
}

export interface CatalogSyncResult {
  provider: string;
  sets: number;
  cards: number;
  /** Correspondances marketplace fournies par la source. */
  links: number;
  /** Prix relevés au passage par la source. */
  quotes: number;
  /** Cartes ajoutées par le complément local. */
  supplemented: number;
  /** Renseigné quand les sources préférées ont échoué. */
  fellBackTo?: string;
  failures?: string[];
}

/**
 * Récupère le catalogue complet chez le fournisseur et le fusionne en base.
 * L'opération est idempotente : on peut la relancer autant qu'on veut.
 */
export async function syncCatalog(provider?: CatalogProvider): Promise<CatalogSyncResult> {
  const chain = provider ? [provider] : providerChain();
  const runId = startSyncRun('catalog', chain.map((p) => p.name).join(' > '));

  const failures: string[] = [];

  try {
    let used: CatalogProvider | null = null;
    let payload: Awaited<ReturnType<CatalogProvider['fetchAll']>> | null = null;

    for (const source of chain) {
      try {
        payload = await source.fetchAll();
        used = source;
        break;
      } catch (error) {
        failures.push(
          `${source.name} : ${error instanceof Error ? error.message.split('\n')[0] : error}`,
        );
      }
    }

    if (!used || !payload) {
      throw new Error(`Aucune source n'a répondu.\n  ${failures.join('\n  ')}`);
    }

    const { sets, cards, links = [], quotes = [] } = payload;

    // Le complément est fusionné après la source : il ajoute les cartes qu'elle
    // ignore — exclusivités régionales, promos d'événements — et corrige ce
    // qu'elle donne de travers, sans jamais être écrasé par elle.
    const supplement = loadSupplement();
    if (supplement) {
      sets.push(...supplement.sets);
      cards.push(...supplement.cards);
    }

    transaction(() => {
      for (const set of sets) {
        upsertSet({
          ...set,
          kind: set.kind ?? inferSetKind(set.id, set.name),
        });
      }
      for (const card of cards) {
        // Une extension peut apparaître via une carte sans être listée : on la crée au vol.
        upsertSet({
          id: card.setId,
          name: card.setName,
          kind: inferSetKind(card.setId, card.setName),
          code: card.setId,
          releaseDate: null,
          imageUrl: null,
        });
        upsertCard(card);
      }

      // Une correspondance fournie par la source prime sur tout rapprochement
      // par nom : on lui donne la confiance maximale.
      for (const link of links) {
        saveMarketLink({
          cardId: link.cardId,
          marketplace: link.marketplace,
          externalId: link.externalId,
          externalName: null,
          query: null,
          url: link.url,
          confidence: 1,
        });
      }

      // Les prix de la source alimentent le relevé du jour, ce qui permet à
      // l'app d'afficher des cotations sans aucune clé d'API.
      const capturedOn = today();
      const capturedAt = nowIso();
      for (const quote of quotes) {
        insertSnapshot({
          cardId: quote.cardId,
          marketplace: quote.marketplace,
          currency: quote.currency,
          low: null,
          market: quote.market,
          avg1: null,
          avg7: null,
          avg30: null,
          listingCount: null,
          foil: quote.foil,
          url: null,
          capturedAt,
          capturedOn,
          estimated: false,
        });
      }
    });

    finishSyncRun(runId, 'success', cards.length, failures.length, failures.join(' | '));
    return {
      provider: used.name,
      sets: sets.length,
      cards: cards.length,
      links: links.length,
      quotes: quotes.length,
      supplemented: supplement?.cards.length ?? 0,
      fellBackTo: failures.length > 0 ? used.name : undefined,
      failures: failures.length > 0 ? failures : undefined,
    };
  } catch (error) {
    finishSyncRun(runId, 'error', 0, 0, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
