/**
 * Rapport de couverture de la base.
 *
 *   npm run api:stats
 *
 * Répond aux questions qu'on se pose quand l'app affiche moins que prévu :
 * combien de cartes ont un prix, sur quelle marketplace, combien de visuels sont
 * en cache, et quels produits sont mal nommés.
 */
import { selectAll, selectOne } from '../db/index.ts';
import { cachedImageCount } from '../images.ts';

function line(label: string, value: string | number): void {
  console.log(`  ${label.padEnd(38)} ${value}`);
}

function main(): void {
  const cards = selectOne<{ n: number }>('SELECT COUNT(*) AS n FROM cards')?.n ?? 0;
  const sets = selectOne<{ n: number }>('SELECT COUNT(*) AS n FROM sets')?.n ?? 0;

  console.log('\nCatalogue');
  line('cartes', cards);
  line('produits', sets);
  line('visuels en cache', cachedImageCount());

  console.log('\nProduits par nature');
  for (const row of selectAll<{ kind: string; n: number }>(
    'SELECT kind, COUNT(*) AS n FROM sets GROUP BY kind ORDER BY n DESC',
  )) {
    line(row.kind, row.n);
  }

  console.log('\nCorrespondances marketplace');
  for (const row of selectAll<{ marketplace: string; n: number }>(
    'SELECT marketplace, COUNT(*) AS n FROM market_links GROUP BY marketplace',
  )) {
    line(row.marketplace, `${row.n} cartes reliées`);
  }

  console.log('\nPrix relevés (cartes distinctes)');
  for (const row of selectAll<{ marketplace: string; n: number; jours: number }>(
    `SELECT marketplace,
            COUNT(DISTINCT card_id) AS n,
            COUNT(DISTINCT captured_on) AS jours
     FROM price_snapshots GROUP BY marketplace`,
  )) {
    line(row.marketplace, `${row.n} cartes · ${row.jours} jour(s) d'historique`);
  }
  if (cards > 0) {
    const withoutPrice =
      selectOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM cards c
         WHERE NOT EXISTS (SELECT 1 FROM price_snapshots p WHERE p.card_id = c.id)`,
      )?.n ?? 0;
    line('sans aucun prix', `${withoutPrice} cartes`);
  }

  // Un produit dont le nom vaut son code n'a pas été nommé : c'est le symptôme
  // d'un champ absent chez la source.
  const unnamed = selectAll<{ id: string }>('SELECT id FROM sets WHERE name = id ORDER BY id');
  console.log('\nProduits sans nom lisible');
  line('nombre', unnamed.length);
  if (unnamed.length > 0) {
    line('exemples', unnamed.slice(0, 12).map((s) => s.id).join(', '));
  }

  console.log('\nÉchantillon');
  for (const row of selectAll<{
    id: string;
    name: string;
    set_name: string;
    prix: string | null;
  }>(
    `SELECT c.id, c.name, s.name AS set_name,
            -- Dernier relevé seulement : sans quoi chaque jour d'historique
            -- ajoute une occurrence et la ligne devient illisible.
            (SELECT GROUP_CONCAT(p.marketplace || '=' || p.market, ' ')
             FROM price_snapshots p
             WHERE p.card_id = c.id AND p.foil = 0
               AND p.captured_on = (
                 SELECT MAX(q.captured_on) FROM price_snapshots q
                 WHERE q.card_id = p.card_id AND q.marketplace = p.marketplace AND q.foil = 0
               )) AS prix
     FROM cards c JOIN sets s ON s.id = c.set_id
     ORDER BY c.id LIMIT 8`,
  )) {
    console.log(`  ${row.id.padEnd(14)} ${(row.name ?? '').slice(0, 22).padEnd(24)} ${(row.set_name ?? '').slice(0, 26).padEnd(28)} ${row.prix ?? '—'}`);
  }
  console.log();
}

main();
