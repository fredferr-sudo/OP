import cron from 'node-cron';
import { syncCatalog } from './catalog/sync.ts';
import { config } from './config.ts';
import { quotedToday, syncCatalogQuotes } from './prices/quotes.ts';
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

  cron.schedule(config.scheduler.priceCron, () => void dailyPrices());

  // Rattrapage au démarrage. Une tâche planifiée à 4 h du matin ne se déclenche
  // jamais sur un ordinateur éteint la nuit : l'historique se remplirait de
  // trous sans que rien ne le signale. Si la journée n'a pas encore son relevé,
  // on le prend maintenant — un point par jour, quelle que soit l'heure
  // d'allumage.
  if (!quotedToday()) {
    console.log("[scheduler] aucun relevé aujourd'hui : rattrapage immédiat");
    void dailyPrices();
  }

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
    `[scheduler] prix "${config.scheduler.priceCron}" · catalogue "${config.scheduler.catalogCron}" · ` +
      `sources avec clé : ${sources.length ? sources.join(', ') : 'aucune'} ` +
      '· Cardmarket : par la source du catalogue, sans clé',
  );
}

/**
 * Le relevé quotidien, dans l'ordre qui compte.
 *
 * Les cotations de la source du catalogue viennent d'abord : elles couvrent
 * tout le catalogue d'un seul appel, sans clé, et ce sont elles qui portent
 * Cardmarket. Les marketplaces à clé suivent, carte par carte et par quota.
 */
async function dailyPrices(): Promise<void> {
  try {
    const quotes = await syncCatalogQuotes();
    console.log(
      `[scheduler] cotations ${quotes.provider} : ${quotes.inserted} relevés ` +
        `(${Object.entries(quotes.byMarketplace).map(([m, n]) => `${m}=${n}`).join(', ')})`,
    );
  } catch (error) {
    console.error('[scheduler] cotations du catalogue en échec', error);
  }

  if (configuredProviders().length === 0) return;

  try {
    const result = await syncPrices();
    console.log(
      `[scheduler] relevé de prix terminé : ${result.processed} cartes, ${result.failed} échecs`,
    );
  } catch (error) {
    console.error('[scheduler] relevé de prix en échec', error);
  }
}
