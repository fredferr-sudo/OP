import { config } from '../config.ts';
import { transaction } from '../db/index.ts';
import { finishSyncRun, startSyncRun, upsertCard, upsertSet } from '../db/repositories.ts';
import { inferSetKind } from './classify.ts';
import { ApiTcgProvider } from './providers/apitcg.ts';
import { LocalProvider } from './providers/local.ts';
import { OptcgProvider } from './providers/optcg.ts';
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
    case 'optcg':
      return [new OptcgProvider(), new LocalProvider()];
    case 'apitcg':
    default:
      // Sans clé, apitcg est inutilisable : on ne la met dans la chaîne que si
      // elle a de quoi s'authentifier.
      return config.catalog.apitcgKey
        ? [new ApiTcgProvider(), new OptcgProvider(), new LocalProvider()]
        : [new OptcgProvider(), new LocalProvider()];
  }
}

export interface CatalogSyncResult {
  provider: string;
  sets: number;
  cards: number;
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

    const { sets, cards } = payload;

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
    });

    finishSyncRun(runId, 'success', cards.length, failures.length, failures.join(' | '));
    return {
      provider: used.name,
      sets: sets.length,
      cards: cards.length,
      fellBackTo: failures.length > 0 ? used.name : undefined,
      failures: failures.length > 0 ? failures : undefined,
    };
  } catch (error) {
    finishSyncRun(runId, 'error', 0, 0, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
