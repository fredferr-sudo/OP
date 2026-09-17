/**
 * Écart entre le catalogue synchronisé et les listes officielles Bandai.
 *
 *   npm run api:gap            # toutes les éditions présentes en base
 *   npm run api:gap -- EN      # une seule
 *
 * La question « quelles cartes me manquent ? » n'a de sens que face à une
 * référence. Les listes de l'éditeur en sont une : ce qu'elles contiennent
 * existe, et une carte du catalogue qui n'y figure pas est soit une carte
 * hors-liste — prix de tournoi, promo d'événement —, soit du bruit de la source.
 *
 * Les deux directions comptent, et pour des raisons opposées :
 *
 *  - ce que la source commerciale ignore est une lacune de l'app : la carte
 *    existe, le joueur la possède peut-être, et elle ne s'affiche nulle part ;
 *  - ce qu'elle ajoute est précisément ce qu'aucune liste officielle ne donne,
 *    donc la seule chose qu'une quatrième source pourrait apporter.
 *
 * C'est le rapport à lire avant d'aller chercher un catalogue ailleurs.
 */
import type { CardLanguage } from '@op/shared';
import { officialIndex } from '../catalog/providers/punkrecords.ts';
import { db, selectAll } from '../db/index.ts';

interface Row {
  id: string;
  code: string;
  name: string;
  set_id: string;
  rarity: string | null;
}

const LABELS: Partial<Record<CardLanguage, string>> = {
  EN: 'Global',
  FR: 'France',
  JP: 'Japon',
};

/** Identifiant de l'impression, débarrassé du suffixe d'édition. */
function rawId(id: string): string {
  const at = id.lastIndexOf('@');
  return (at < 0 ? id : id.slice(0, at)).toUpperCase();
}

function summarize(rows: Row[], limit = 12): void {
  const byProduct = new Map<string, Row[]>();
  for (const row of rows) {
    const bucket = byProduct.get(row.set_id) ?? [];
    bucket.push(row);
    byProduct.set(row.set_id, bucket);
  }

  const ordered = [...byProduct.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [setId, cards] of ordered.slice(0, limit)) {
    const sample = cards
      .slice(0, 3)
      .map((c) => `${rawId(c.id)} ${c.name.slice(0, 18)}`)
      .join(' · ');
    console.log(`      ${String(cards.length).padStart(4)}  ${setId.padEnd(22)} ${sample}`);
  }
  if (ordered.length > limit) {
    console.log(`      … et ${ordered.length - limit} autre(s) produit(s).`);
  }
}

async function report(language: CardLanguage): Promise<void> {
  const label = LABELS[language] ?? language;
  console.log(`\n── Édition ${label} (${language}) ${'─'.repeat(Math.max(0, 40 - label.length))}`);

  const rows = selectAll<Row>(
    'SELECT id, code, name, set_id, rarity FROM cards WHERE language = @language',
    { language },
  );

  if (rows.length === 0) {
    console.log("  Aucune carte dans cette édition : rien à comparer.");
    return;
  }

  let official: Record<string, { name: string; rarity: string | null }>;
  try {
    official = await officialIndex(language);
  } catch (error) {
    console.log(
      `  Liste officielle indisponible — ${error instanceof Error ? error.message : error}`,
    );
    return;
  }

  const local = new Map(rows.map((row) => [rawId(row.id), row]));
  const officialIds = new Set(Object.keys(official));

  const extra = rows.filter((row) => !officialIds.has(rawId(row.id)));
  const absent = [...officialIds].filter((id) => !local.has(id));

  console.log(
    `  catalogue local : ${rows.length} cartes · liste officielle Bandai : ${officialIds.size}`,
  );

  console.log(`\n  ▸ ${absent.length} carte(s) de la liste officielle absentes du catalogue`);
  if (absent.length > 0) {
    console.log("    La carte existe et l'app ne l'affiche pas : c'est une lacune à combler.");
    summarize(
      absent.map((id) => ({
        id,
        code: id.replace(/_P\d+$/i, ''),
        name: official[id].name,
        set_id: id.split('-')[0] ?? '?',
        rarity: official[id].rarity,
      })),
    );
  }

  console.log(`\n  ▸ ${extra.length} carte(s) du catalogue absentes de la liste officielle`);
  if (extra.length > 0) {
    console.log(
      '    Cartes hors-liste (prix de tournoi, promos d\'événement) ou bruit de la\n' +
        "    source. C'est le seul terrain où une source supplémentaire apporterait\n" +
        "    quelque chose : tout le reste, l'éditeur le publie déjà.",
    );
    summarize(extra);
  }
}

async function main(): Promise<void> {
  db();

  const asked = process.argv
    .slice(2)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean) as CardLanguage[];

  const present = selectAll<{ language: string }>(
    'SELECT language FROM cards GROUP BY language ORDER BY COUNT(*) DESC',
  ).map((row) => row.language as CardLanguage);

  const languages = asked.length > 0 ? asked : present;
  if (languages.length === 0) {
    console.log('\nLe catalogue est vide. Lance « npm run api:sync -- catalog ».\n');
    return;
  }

  for (const language of languages) await report(language);
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nÉchec : ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
