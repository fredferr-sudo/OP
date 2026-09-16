/**
 * Synchronisation en ligne de commande.
 *
 *   npm run api:sync -- catalog        # catalogue complet
 *   npm run api:sync -- prices         # relevé de prix (500 cartes)
 *   npm run api:sync -- prices --limit 50
 *   npm run api:sync -- all
 */
import { createCatalogProvider, syncCatalog } from '../catalog/sync.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { configuredProviders, syncPrices } from '../prices/sync.js';

async function main(): Promise<void> {
  db();

  const args = process.argv.slice(2);
  const command = args[0] ?? 'all';
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;

  if (command === 'catalog' || command === 'all') {
    const result = await syncCatalog();
    console.log(
      `Catalogue (${result.provider}) : ${result.cards} cartes dans ${result.sets} produits.`,
    );
  }

  if (command === 'prices' || command === 'all') {
    const sources = configuredProviders().map((p) => p.marketplace);
    if (sources.length === 0) {
      console.log(
        'Aucune source de prix configurée. Renseigne les clés dans services/api/.env ' +
          '(voir .env.example) pour activer Cardmarket / TCGplayer / eBay.',
      );
    } else {
      const result = await syncPrices({ limit });
      console.log(
        `Prix : ${result.processed} cartes traitées, ${result.failed} échecs. ` +
          `Détail : ${JSON.stringify(result.byMarketplace)}`,
      );
    }
  }
}

/**
 * Un échec de synchronisation est presque toujours un problème d'accès réseau ou
 * de clé manquante, pas un bug. On explique ce qui s'est passé et ce qu'on peut
 * faire, plutôt que d'afficher une trace d'appels.
 */
function explain(error: unknown): string {
  const lines: string[] = [];

  if (error instanceof HttpError) {
    lines.push(`La source a répondu ${error.status} sur ${error.url}.`);
  } else if (error instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED|abort/i.test(error.message)) {
    lines.push('La source du catalogue est injoignable depuis cette machine.');
  } else {
    lines.push(error instanceof Error ? error.message : String(error));
  }

  // On affiche la source réellement utilisée : `apitcg` sans clé se replie
  // silencieusement sur `optcg`, et annoncer `apitcg` induirait en erreur.
  const effective = createCatalogProvider().name;
  const configured = config.catalog.provider;
  lines.push('');
  lines.push(
    effective === configured
      ? `Source utilisée : ${effective}`
      : `Source utilisée : ${effective} (CATALOG_PROVIDER=${configured}, sans clé API : repli automatique)`,
  );
  lines.push('');
  lines.push('Pistes :');
  lines.push('  • Vérifie ta connexion, puis relance la commande.');
  lines.push(
    "  • Pour démarrer sans réseau, mets CATALOG_PROVIDER=local dans services/api/.env :",
  );
  lines.push("    l'app tournera sur un petit catalogue de démonstration embarqué.");
  lines.push('  • Avec une clé apitcg.com : CATALOG_PROVIDER=apitcg et APITCG_KEY=…');

  return lines.join('\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nÉchec de la synchronisation.\n\n${explain(error)}\n`);
    process.exit(1);
  });
