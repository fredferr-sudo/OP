/**
 * Analyse du classement des cartes par produit.
 *
 *   npm run api:analyse
 *
 * Les alt-arts apparaissent dans la mauvaise extension : le champ `set` de la
 * source suit le numéro de la carte, pas le produit où l'illustration a été
 * distribuée, lequel figure dans `CardSets`.
 *
 * Établir la bonne règle demande de savoir comment les deux champs se comportent
 * sur l'ensemble du catalogue, pas sur une carte : combien d'entrées compte
 * `CardSets`, à quelle fréquence `set` y figure, et ce que changerait un
 * classement fondé sur `CardSets`. Ce rapport répond à ces questions et montre
 * des exemples de chaque cas.
 */
import { normalizeSetId, parseCardSets, productKey, resolveProductId } from '../catalog/classify.ts';
import { config } from '../config.ts';
import { requestJson } from '../lib/http.ts';

interface Row {
  id?: string;
  id_normal?: string;
  name?: string;
  set?: string;
  CardSets?: string;
  language?: string;
  cardType?: string;
}

// Le champ `set` passe par la même normalisation que le catalogue — identifiants
// composites compris — sans quoi le rapport compterait comme « absent » un code
// que le catalogue rapproche très bien.

function line(label: string, value: string | number): void {
  console.log(`  ${label.padEnd(44)} ${value}`);
}

function examples(title: string, rows: Row[], limit = 6): void {
  if (rows.length === 0) return;
  console.log(`\n${title} (${rows.length})`);
  for (const row of rows.slice(0, limit)) {
    const sets = (row.CardSets ?? '').replace(/\s+/g, ' ').slice(0, 78);
    console.log(`  ${String(row.id).padEnd(16)} set=${String(row.set).padEnd(10)} ${sets}`);
  }
}


/**
 * Effectifs attendus par produit, relevés dans l'app op.tcg (édition Global).
 * Ils servent d'étalon : une règle de classement correcte doit les retrouver.
 */
const EXPECTED: Array<{ code: string; name: string; count: number }> = [
  { code: 'OP01', name: 'Romance Dawn', count: 155 },
  { code: 'OP02', name: 'Paramount War', count: 155 },
  { code: 'OP03', name: 'Pillars of Strength', count: 155 },
  { code: 'OP04', name: 'Kingdoms of Intrigue', count: 150 },
  { code: 'OP05', name: 'Awakening of the New Era', count: 155 },
  { code: 'OP06', name: 'Wings of the Captain', count: 152 },
  { code: 'OP07', name: '500 Years in the Future', count: 152 },
  { code: 'OP08', name: 'Two Legends', count: 152 },
  { code: 'OP09', name: 'Emperors in the New World', count: 160 },
  { code: 'OP10', name: 'Royal Blood', count: 152 },
  { code: 'EB01', name: 'Memorial Collection', count: 80 },
  { code: 'EB02', name: 'Anime 25th Collection', count: 105 },
  { code: 'EB03', name: 'Heroines Edition', count: 98 },
  { code: 'EB04', name: 'Egghead Crisis', count: 87 },
  { code: 'PRB01', name: 'The Best', count: 409 },
  { code: 'PRB02', name: 'The Best Vol.2', count: 406 },
];


/**
 * Composition d'un produit sous la règle « code ou nom », restreinte à l'anglais.
 *
 * Quand l'effectif dépasse encore l'étalon, c'est cette ventilation qui dit
 * pourquoi : un type de carte versé à tort, des illustrations alternatives
 * comptées deux fois, ou des cartes d'une autre édition.
 */
function composition(rows: Row[], code: string): void {
  const members = rows.filter((row) => {
    if (String(row.language ?? '').trim().toLowerCase() !== 'en') return false;
    const id = String(row.id_normal ?? row.id ?? '');
    return resolveProductId(id, row.set, parseCardSets(row.CardSets)[0]) === code;
  });

  console.log(`\nComposition de ${code} sous la règle retenue — ${members.length} cartes`);

  const byType = new Map<string, number>();
  const byPrefix = new Map<string, number>();
  let alternates = 0;

  for (const row of members) {
    const type = String(row.cardType ?? '(vide)');
    byType.set(type, (byType.get(type) ?? 0) + 1);

    const id = String(row.id ?? '').toUpperCase();
    const prefix = id.split('-')[0] || '(vide)';
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);

    if (id !== String(row.id_normal ?? id).toUpperCase()) alternates += 1;
  }

  line('illustrations alternatives', alternates);
  line('illustrations de base', members.length - alternates);

  const show = (label: string, map: Map<string, number>) => {
    const parts = [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, count]) => `${key}=${count}`);
    line(label, parts.join(', '));
  };
  show('par type de carte', byType);
  show('par préfixe d\'identifiant', byPrefix);
}

type Assignment = Map<string, Set<string>>;

function add(target: Assignment, setId: string, cardId: string): void {
  if (!setId || !cardId) return;
  const bucket = target.get(setId) ?? new Set<string>();
  bucket.add(cardId);
  target.set(setId, bucket);
}

/**
 * Compare les règles de classement candidates aux effectifs attendus.
 *
 * « set » est la règle actuelle : une carte appartient au produit que nomme son
 * champ `set`. « CardSets » est la règle envisagée : une carte appartient à tous
 * les produits où la source dit qu'elle figure, ce qui autorise une même
 * illustration à compter dans plusieurs produits. L'écart à l'étalon tranche.
 */
function simulate(rows: Row[]): void {
  const bySet: Assignment = new Map();
  const bySetEn: Assignment = new Map();
  const byCardSets: Assignment = new Map();
  const byCardSetsEn: Assignment = new Map();
  const byNamed: Assignment = new Map();
  const byNamedEn: Assignment = new Map();
  const byRule: Assignment = new Map();
  const byRuleEn: Assignment = new Map();
  let pairs = 0;

  for (const row of rows) {
    const id = String(row.id ?? '').toUpperCase();
    if (!id) continue;
    const english = String(row.language ?? '').trim().toLowerCase() === 'en';
    const setId = normalizeSetId(String(row.set ?? ''));

    add(bySet, setId, id);
    if (english) add(bySetEn, setId, id);

    const entries = parseCardSets(row.CardSets);

    // Règle « code » : on ne retient que les produits portant un code entre
    // crochets, comme avant.
    const coded = entries.filter((entry) => entry.code !== null).map((entry) => entry.code as string);
    for (const code of coded.length > 0 ? coded : [setId]) {
      add(byCardSets, code, id);
      if (english) add(byCardSetsEn, code, id);
      pairs += 1;
    }

    // Règle « code ou nom » : un produit nommé sans code compte aussi, ce qui
    // rend les packs de tournoi et les promos à leur produit réel.
    const keys = entries.length > 0 ? entries.map(productKey) : [setId];
    for (const key of keys) {
      add(byNamed, key, id);
      if (english) add(byNamedEn, key, id);
    }

    // Règle retenue, celle que le catalogue applique désormais.
    const resolved = resolveProductId(String(row.id_normal ?? id), row.set, entries[0]);
    add(byRule, resolved, id);
    if (english) add(byRuleEn, resolved, id);
  }

  const size = (assignment: Assignment, code: string): number => assignment.get(code)?.size ?? 0;
  const gap = (value: number, expected: number): string => {
    const delta = value - expected;
    return delta === 0 ? 'exact' : `${delta > 0 ? '+' : ''}${delta}`;
  };

  console.log('\nSimulation de classement — écart aux effectifs op.tcg (édition Global)');
  console.log(
    `  ${'produit'.padEnd(8)}${'attendu'.padEnd(9)}${'set'.padEnd(10)}${'code+nom/en'.padEnd(13)}${'RETENUE/en'}`,
  );
  for (const target of EXPECTED) {
    const viaSet = size(bySet, target.code);
    const viaNamedEn = size(byNamedEn, target.code);
    const viaRuleEn = size(byRuleEn, target.code);
    console.log(
      `  ${target.code.padEnd(8)}${String(target.count).padEnd(9)}` +
        `${`${viaSet} (${gap(viaSet, target.count)})`.padEnd(10)}` +
        `${`${viaNamedEn} (${gap(viaNamedEn, target.count)})`.padEnd(13)}` +
        `${viaRuleEn} (${gap(viaRuleEn, target.count)})`,
    );
  }

  // Ce qui reste en trop dans un produit de référence : sa composition dit
  // quelle catégorie de cartes la règle y verse à tort.
  composition(rows, 'OP01');

  console.log('');
  line('produits — règle actuelle', bySet.size);
  line('produits — règle code', byCardSets.size);
  line('produits — règle code+nom', byNamed.size);
  line('produits — règle retenue', byRule.size);
  line('couples carte-produit — règle CardSets', pairs);
  line('cartes anglaises rattachées (CardSets)', [...byCardSetsEn.values()].reduce((n, s) => n + s.size, 0));

  // L'étalon ne couvre qu'une quinzaine de produits sur la septantaine que
  // compte le catalogue. Il suffit à choisir la règle, pas à garantir qu'elle
  // ne dérange rien ailleurs : on liste donc ce qu'elle déplace vraiment.
  const codes = new Set([...bySet.keys(), ...byCardSets.keys()]);
  const movements: Array<{ code: string; before: number; after: number }> = [];
  for (const code of codes) {
    const before = size(bySet, code);
    const after = size(byCardSets, code);
    if (before !== after) movements.push({ code, before, after });
  }
  movements.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));

  console.log('\nCe que la nouvelle règle déplace');
  line('produits dont l\'effectif change', movements.length);
  for (const move of movements.slice(0, 14)) {
    line(`  ${move.code}`, `${move.before} -> ${move.after} (${gap(move.after, move.before)})`);
  }

  // Deux signaux d'alarme : un produit qui perdrait toutes ses cartes, et un
  // produit qui n'existerait que par la nouvelle règle.
  const emptied = [...codes].filter((code) => size(bySet, code) > 0 && size(byCardSets, code) === 0);
  const created = [...codes].filter((code) => size(bySet, code) === 0 && size(byCardSets, code) > 0);

  console.log('');
  line('produits vidés par la nouvelle règle', emptied.length);
  if (emptied.length > 0) line('  lesquels', emptied.slice(0, 20).join(', '));
  line('produits créés par la nouvelle règle', created.length);
  if (created.length > 0) line('  lesquels', created.slice(0, 20).join(', '));
}

async function main(): Promise<void> {
  const payload = await requestJson<unknown>(config.catalog.dotggUrl, {
    headers: { accept: 'application/json' },
    timeoutMs: 60_000,
  });
  const rows = (Array.isArray(payload) ? payload : ((payload as { data?: unknown[] }).data ?? [])) as Row[];

  const buckets = { zero: 0, one: 0, two: 0, more: 0 };
  const base = { withSet: 0, withoutSet: 0, empty: 0 };
  const alt = { oneEqual: 0, oneDifferent: 0, manyWithSet: 0, manyWithoutSet: 0, empty: 0 };

  const setValues = new Set<string>();
  const cardSetCodes = new Set<string>();
  let namedOnly = 0;

  const sampleAltOneDifferent: Row[] = [];
  const sampleAltManyWithSet: Row[] = [];
  const sampleAltManyWithoutSet: Row[] = [];
  const sampleBaseWithoutSet: Row[] = [];
  const sampleEmpty: Row[] = [];

  for (const row of rows) {
    const id = String(row.id ?? '');
    const normal = String(row.id_normal ?? id);
    const setId = normalizeSetId(String(row.set ?? ''));
    setValues.add(setId);

    const entries = parseCardSets(row.CardSets);
    for (const entry of entries) if (entry.code) cardSetCodes.add(entry.code);

    if (entries.length === 0) buckets.zero += 1;
    else if (entries.length === 1) buckets.one += 1;
    else if (entries.length === 2) buckets.two += 1;
    else buckets.more += 1;

    const containsSet = entries.some((entry) => entry.code === setId);
    if (entries.length > 0 && entries.every((entry) => entry.code === null)) namedOnly += 1;
    const isAlt = id.toUpperCase() !== normal.toUpperCase();

    if (entries.length === 0) {
      if (isAlt) alt.empty += 1;
      else base.empty += 1;
      if (sampleEmpty.length < 6) sampleEmpty.push(row);
      continue;
    }

    if (!isAlt) {
      if (containsSet) base.withSet += 1;
      else {
        base.withoutSet += 1;
        if (sampleBaseWithoutSet.length < 6) sampleBaseWithoutSet.push(row);
      }
      continue;
    }

    if (entries.length === 1) {
      if (containsSet) alt.oneEqual += 1;
      else {
        alt.oneDifferent += 1;
        if (sampleAltOneDifferent.length < 6) sampleAltOneDifferent.push(row);
      }
    } else if (containsSet) {
      alt.manyWithSet += 1;
      if (sampleAltManyWithSet.length < 6) sampleAltManyWithSet.push(row);
    } else {
      alt.manyWithoutSet += 1;
      if (sampleAltManyWithoutSet.length < 6) sampleAltManyWithoutSet.push(row);
    }
  }

  const altTotal = alt.oneEqual + alt.oneDifferent + alt.manyWithSet + alt.manyWithoutSet + alt.empty;
  const baseTotal = base.withSet + base.withoutSet + base.empty;

  console.log(`\nAnalyse du classement — ${rows.length} enregistrements\n`);

  console.log('Entrées « CardSets » par carte');
  line('aucune', buckets.zero);
  line('une', buckets.one);
  line('deux', buckets.two);
  line('trois et plus', buckets.more);

  console.log(`\nIllustration de base — ${baseTotal} cartes`);
  line('set figure dans CardSets', base.withSet);
  line('set absent de CardSets', base.withoutSet);
  line('CardSets vide', base.empty);

  console.log(`\nIllustration alternative — ${altTotal} cartes`);
  line('une entrée, égale à set', alt.oneEqual);
  line('une entrée, différente de set', alt.oneDifferent);
  line('plusieurs entrées, dont set', alt.manyWithSet);
  line('plusieurs entrées, sans set', alt.manyWithoutSet);
  line('CardSets vide', alt.empty);

  console.log('\nProduits');
  line('valeurs distinctes du champ set', setValues.size);
  line('codes distincts dans CardSets', cardSetCodes.size);
  const unseen = [...cardSetCodes].filter((c) => !setValues.has(c)).sort();
  line('produits nommés sans code', namedOnly);
  line('codes vus seulement dans CardSets', unseen.length);
  if (unseen.length > 0) line('lesquels', unseen.slice(0, 24).join(', '));

  // --- Langues : de quoi savoir si l'app peut distinguer les éditions
  //     internationale, française et japonaise, et sur quelles données.
  const byLanguage = new Map<string, { count: number; sets: Set<string>; sample: string[] }>();
  for (const row of rows) {
    const language = String(row.language ?? '').trim().toLowerCase() || '(vide)';
    let entry = byLanguage.get(language);
    if (!entry) {
      entry = { count: 0, sets: new Set(), sample: [] };
      byLanguage.set(language, entry);
    }
    entry.count += 1;
    entry.sets.add(normalizeSetId(String(row.set ?? '')));
    if (entry.sample.length < 3) entry.sample.push(String(row.id ?? ''));
  }

  console.log('\nLangues');
  for (const [language, entry] of [...byLanguage.entries()].sort((a, b) => b[1].count - a[1].count)) {
    line(language, `${entry.count} cartes · ${entry.sets.size} produits · ex. ${entry.sample.join(', ')}`);
  }

  // Une carte imprimée en plusieurs langues porte-t-elle le même identifiant ?
  // C'est ce qui décide si les éditions sont des cartes distinctes ou une seule
  // carte déclinée, et donc comment l'app doit les présenter.
  const idLanguages = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = String(row.id ?? '').toUpperCase();
    if (!id) continue;
    const language = String(row.language ?? '').trim().toLowerCase() || '(vide)';
    const seen = idLanguages.get(id) ?? new Set<string>();
    seen.add(language);
    idLanguages.set(id, seen);
  }
  const multilingual = [...idLanguages.entries()].filter(([, langs]) => langs.size > 1);
  line('identifiants vus en plusieurs langues', multilingual.length);
  if (multilingual.length > 0) {
    line('exemples', multilingual.slice(0, 6).map(([id, langs]) => `${id} (${[...langs].join('/')})`).join(', '));
  }

  simulate(rows);

  examples('Alt-art, une entrée différente de set', sampleAltOneDifferent);
  examples('Alt-art, plusieurs entrées dont set', sampleAltManyWithSet);
  examples('Alt-art, plusieurs entrées sans set', sampleAltManyWithoutSet);
  examples('Base, set absent de CardSets', sampleBaseWithoutSet);
  examples('CardSets vide', sampleEmpty);
  console.log();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
