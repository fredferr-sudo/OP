/**
 * Synchronisation en ligne de commande.
 *
 *   npm run sync -w @op/api -- catalog        # catalogue complet
 *   npm run sync -w @op/api -- prices         # relevé de prix (500 cartes)
 *   npm run sync -w @op/api -- prices --limit 50
 *   npm run sync -w @op/api -- all
 */
import { syncCatalog } from '../catalog/sync.js';
import { db } from '../db/index.js';
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

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
