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
import { normalizeSetId, parseCardSets } from '../catalog/classify.ts';
import { config } from '../config.ts';
import { requestJson } from '../lib/http.ts';

interface Row {
  id?: string;
  id_normal?: string;
  name?: string;
  set?: string;
  CardSets?: string;
  language?: string;
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
    for (const entry of entries) cardSetCodes.add(entry.code);

    if (entries.length === 0) buckets.zero += 1;
    else if (entries.length === 1) buckets.one += 1;
    else if (entries.length === 2) buckets.two += 1;
    else buckets.more += 1;

    const containsSet = entries.some((entry) => entry.code === setId);
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
