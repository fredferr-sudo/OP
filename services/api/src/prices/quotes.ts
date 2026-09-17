/**
 * Relevé quotidien des prix fournis par la source du catalogue.
 *
 * Les cotations Cardmarket n'arrivent pas par l'API de Cardmarket — elle
 * n'accepte plus de demandes d'accès — mais par la source du catalogue, qui les
 * transporte avec chaque carte. Elles ne coûtent donc aucune clé, et c'est ce
 * qui rend le suivi de prix possible dès la première synchronisation.
 *
 * Mais elles étaient écrites par la synchronisation du catalogue, qui ne tourne
 * qu'une fois par semaine : l'historique gagnait un point tous les sept jours.
 * Ce module ne fait que la partie prix — récupérer la source, écrire les
 * relevés du jour, rien d'autre — pour qu'elle puisse tourner quotidiennement
 * sans refaire le classement, les éditions régionales et la découverte.
 */
import { providerChain } from '../catalog/sync.ts';
import { nowIso, selectOne, today } from '../db/index.ts';
import { finishSyncRun, insertSnapshot, startSyncRun } from '../db/repositories.ts';

export interface QuoteSyncResult {
  provider: string;
  /** Relevés écrits, toutes marketplaces confondues. */
  inserted: number;
  byMarketplace: Partial<Record<string, number>>;
}

export async function syncCatalogQuotes(): Promise<QuoteSyncResult> {
  const chain = providerChain();
  const runId = startSyncRun('quotes', chain.map((provider) => provider.name).join(' > '));

  try {
    const failures: string[] = [];
    for (const source of chain) {
      let quotes;
      try {
        ({ quotes = [] } = await source.fetchAll());
      } catch (error) {
        failures.push(
          `${source.name} : ${error instanceof Error ? error.message.split('\n')[0] : error}`,
        );
        continue;
      }

      const capturedOn = today();
      const capturedAt = nowIso();
      const byMarketplace: Partial<Record<string, number>> = {};

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
        byMarketplace[quote.marketplace] = (byMarketplace[quote.marketplace] ?? 0) + 1;
      }

      finishSyncRun(runId, 'success', quotes.length, failures.length, failures.join(' | '));
      return { provider: source.name, inserted: quotes.length, byMarketplace };
    }

    throw new Error(`Aucune source n'a répondu.\n  ${failures.join('\n  ')}`);
  } catch (error) {
    finishSyncRun(runId, 'error', 0, 0, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Vrai si un relevé a déjà été écrit aujourd'hui.
 *
 * Sert au rattrapage au démarrage : une tâche planifiée à 4 h du matin ne se
 * déclenche jamais sur un ordinateur éteint la nuit, et l'historique se serait
 * rempli de trous sans qu'on comprenne pourquoi.
 */
export function quotedToday(): boolean {
  const row = selectOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM price_snapshots WHERE captured_on = @day',
    { day: today() },
  );
  return (row?.n ?? 0) > 0;
}
