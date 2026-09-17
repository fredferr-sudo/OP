/**
 * Synchronisation en ligne de commande.
 *
 *   npm run api:sync -- catalog        # catalogue complet
 *   npm run api:sync -- prices         # relevé de prix (500 cartes)
 *   npm run api:sync -- prices --limit 50
 *   npm run api:sync -- all
 */
import { createCatalogProvider, syncCatalog } from '../catalog/sync.ts';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { HttpError } from '../lib/http.ts';
import { syncCatalogQuotes } from '../prices/quotes.ts';
import { configuredProviders, syncPrices } from '../prices/sync.ts';

async function main(): Promise<void> {
  db();

  const args = process.argv.slice(2);
  const command = args[0] ?? 'all';
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;

  if (command === 'catalog' || command === 'all') {
    const result = await syncCatalog({ onProgress: (step) => console.log(step) });
    console.log(
      `Catalogue (${result.provider}) : ${result.cards} cartes dans ${result.sets} produits.`,
    );
    if (result.links > 0) {
      console.log(
        `Correspondances marketplace : ${result.links} · prix relevés : ${result.quotes}`,
      );
    }
    if (result.supplemented > 0) {
      console.log(`Complément local : ${result.supplemented} cartes ajoutées.`);
    }

    const printings = Object.entries(result.printings).filter(([, n]) => n);
    if (printings.length > 0) {
      console.log(
        `Éditions supplémentaires : ${printings.map(([l, n]) => `${l}=${n}`).join(', ')} ` +
          '(listes officielles Bandai de chaque région).',
      );
    }
    if (result.offList > 0) {
      console.log(
        `Cartes hors-liste : ${result.offList} tirage(s) repéré(s) dans les annonces eBay.`,
      );
    }
    if (result.printingsError) {
      console.log(
        `\nÉditions supplémentaires indisponibles — ${result.printingsError}\n` +
          "  Le catalogue global est à jour ; il manque seulement les impressions régionales.\n" +
          '  Elles demandent `git` sur le PATH et un accès à github.com.',
      );
    }

    // Une bascule silencieuse serait trompeuse : sur le catalogue local, l'app
    // n'affiche qu'une douzaine de cartes de démonstration.
    if (result.failures) {
      console.log('\nSources écartées en chemin :');
      for (const failure of result.failures) console.log(`  • ${failure}`);
      if (result.provider === 'local') {
        console.log(
          "\nATTENTION : c'est le catalogue de démonstration embarqué, pas le jeu complet.\n" +
            'Lance `npm run api:probe` pour voir ce que répondent les sources distantes.',
        );
      }
    }
  }

  if (command === 'prices' || command === 'all') {
    // Les cotations de la source du catalogue d'abord : tout le catalogue en un
    // appel, sans clé, et c'est par là qu'arrive Cardmarket.
    try {
      const quotes = await syncCatalogQuotes();
      console.log(
        `Cotations ${quotes.provider} : ${quotes.inserted} relevés · ` +
          Object.entries(quotes.byMarketplace).map(([m, n]) => `${m}=${n}`).join(', '),
      );
    } catch (error) {
      console.log(
        `Cotations du catalogue indisponibles : ${error instanceof Error ? error.message.split('\n')[0] : error}`,
      );
    }

    const sources = configuredProviders().map((p) => p.marketplace);
    if (sources.length === 0) {
      console.log(
        'Marketplaces à clé : aucune configurée. TCGplayer et eBay ajoutent leurs\n' +
          'propres cotations ; leurs clés sont gratuites (voir .env.example).',
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
