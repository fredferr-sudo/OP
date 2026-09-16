import cron from 'node-cron';
import { syncCatalog } from './catalog/sync.ts';
import { config } from './config.ts';
import { configuredProviders, syncPrices } from './prices/sync.ts';

/**
 * Tâches planifiées : c'est ce qui rend l'historique possible.
 * Chaque jour, un relevé est écrit en base ; au bout d'un mois, l'historique
 * sur 30 jours est intégralement composé de valeurs réelles.
 */
export function startScheduler(): void {
  if (!config.scheduler.enabled) {
    console.log('[scheduler] désactivé (SCHEDULER_ENABLED=false)');
    return;
  }

  cron.schedule(config.scheduler.priceCron, () => {
    void syncPrices()
      .then((result) => {
        console.log(
          `[scheduler] relevé de prix terminé : ${result.processed} cartes, ${result.failed} échecs`,
        );
      })
      .catch((error) => console.error('[scheduler] relevé de prix en échec', error));
  });

  cron.schedule(config.scheduler.catalogCron, () => {
    void syncCatalog()
      .then((result) => {
        console.log(
          `[scheduler] catalogue synchronisé : ${result.cards} cartes, ${result.sets} extensions`,
        );
      })
      .catch((error) => console.error('[scheduler] synchro catalogue en échec', error));
  });

  const sources = configuredProviders().map((p) => p.marketplace);
  console.log(
    `[scheduler] prix "${config.scheduler.priceCron}" · catalogue "${config.scheduler.catalogCron}" · sources : ${
      sources.length ? sources.join(', ') : 'aucune (voir .env)'
    }`,
  );
}
