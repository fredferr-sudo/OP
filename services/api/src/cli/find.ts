/**
 * Recherche dans le catalogue synchronisé.
 *
 *   npm run api:find -- grevin
 *   npm run api:find -- TR
 *   npm run api:find -- OP12-
 *
 * Sert à vérifier ce que la source couvre réellement : une carte connue mais
 * absente ici signale une lacune du catalogue, pas un défaut de l'app. Utile
 * en particulier pour les exclusivités régionales, que les sources
 * internationales ignorent souvent.
 */
import { selectAll } from '../db/index.ts';

interface Hit {
  id: string;
  name: string;
  rarity: string | null;
  language: string;
  set_name: string;
  set_id: string;
}

function main(): void {
  const term = process.argv.slice(2).join(' ').trim();
  if (!term) {
    console.log('\nIndique un terme : npm run api:find -- grevin\n');
    return;
  }

  const like = `%${term}%`;

  // Le nom passe par l'index plein texte, qui ignore les accents — « grevin »
  // doit trouver « Grévin ». Le terme est mis entre guillemets : sans cela, un
  // tiret serait lu comme l'opérateur de négation de la syntaxe de recherche,
  // et « FR-EVENT » échouerait. La comparaison littérale reste en parallèle,
  // car elle retrouve un fragment au milieu d'un identifiant.
  const fts = `"${term.replace(/"/g, '""')}"*`;

  const columns =
    'c.id, c.name, c.rarity, c.language, s.name AS set_name, s.id AS set_id';
  const literal =
    'c.id LIKE @like COLLATE NOCASE OR c.name LIKE @like COLLATE NOCASE' +
    ' OR c.rarity = @exact COLLATE NOCASE OR s.name LIKE @like COLLATE NOCASE';

  const search = (withFts: boolean): Hit[] =>
    selectAll<Hit>(
      `SELECT ${columns}
       FROM cards c JOIN sets s ON s.id = c.set_id
       WHERE ${withFts ? 'c.id IN (SELECT id FROM cards_fts WHERE cards_fts MATCH @fts) OR ' : ''}${literal}
       ORDER BY c.id
       LIMIT 60`,
      { fts, like, exact: term },
    );

  // Un terme que la syntaxe plein texte refuse ne doit pas faire échouer la
  // recherche : on retombe sur la comparaison littérale seule.
  let hits: Hit[];
  try {
    hits = search(true);
  } catch {
    hits = search(false);
  }

  console.log(`\n« ${term} » — ${hits.length} résultat(s)${hits.length === 60 ? ' (tronqué)' : ''}\n`);
  for (const hit of hits) {
    console.log(
      `  ${hit.id.padEnd(16)} ${String(hit.rarity ?? '—').padEnd(5)} ${hit.language.padEnd(4)} ` +
        `${hit.name.slice(0, 28).padEnd(30)} ${hit.set_id.padEnd(8)} ${hit.set_name.slice(0, 30)}`,
    );
  }

  // Une rareté absente du catalogue est une information en soi : elle dit que la
  // source ne couvre pas cette catégorie d'impressions.
  const rarities = selectAll<{ rarity: string; n: number }>(
    'SELECT rarity, COUNT(*) AS n FROM cards WHERE rarity IS NOT NULL GROUP BY rarity ORDER BY n DESC',
  );
  console.log(`\nRaretés présentes dans le catalogue : ${rarities.map((r) => `${r.rarity}=${r.n}`).join(', ')}`);

  const languages = selectAll<{ language: string; n: number }>(
    'SELECT language, COUNT(*) AS n FROM cards GROUP BY language ORDER BY n DESC',
  );
  console.log(`Langues : ${languages.map((l) => `${l.language}=${l.n}`).join(', ')}\n`);
}

main();
