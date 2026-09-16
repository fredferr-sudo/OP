import { config } from '../config.js';
import { transaction } from '../db/index.js';
import { finishSyncRun, startSyncRun, upsertCard, upsertSet } from '../db/repositories.js';
import { inferSetKind } from './classify.js';
import { ApiTcgProvider } from './providers/apitcg.js';
import { LocalProvider } from './providers/local.js';
import { OptcgProvider } from './providers/optcg.js';
import type { CatalogProvider } from './types.js';

export function createCatalogProvider(): CatalogProvider {
  switch (config.catalog.provider) {
    case 'apitcg':
      // Sans clé, on bascule automatiquement plutôt que d'échouer au démarrage.
      return config.catalog.apitcgKey ? new ApiTcgProvider() : new OptcgProvider();
    case 'optcg':
      return new OptcgProvider();
    case 'local':
      return new LocalProvider();
    default:
      return new LocalProvider();
  }
}

export interface CatalogSyncResult {
  provider: string;
  sets: number;
  cards: number;
}

/**
 * Récupère le catalogue complet chez le fournisseur et le fusionne en base.
 * L'opération est idempotente : on peut la relancer autant qu'on veut.
 */
export async function syncCatalog(
  provider: CatalogProvider = createCatalogProvider(),
): Promise<CatalogSyncResult> {
  const runId = startSyncRun('catalog', provider.name);

  try {
    const { sets, cards } = await provider.fetchAll();

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

    finishSyncRun(runId, 'success', cards.length, 0);
    return { provider: provider.name, sets: sets.length, cards: cards.length };
  } catch (error) {
    finishSyncRun(runId, 'error', 0, 0, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
