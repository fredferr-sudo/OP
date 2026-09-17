/**
 * Sonde les sources de catalogue.
 *
 *   npm run api:probe
 *
 * Les APIs communautaires du One Piece Card Game ne publient pas de contrat
 * stable, et leurs URL bougent. Plutôt que de coder une adresse en dur et de
 * découvrir sur la machine de l'utilisateur qu'elle renvoie 404, cette commande
 * interroge chaque candidate et décrit ce qu'elle a réellement reçu : code HTTP,
 * type de contenu, forme du JSON, et champs du premier enregistrement.
 *
 * C'est aussi l'outil à lancer quand une synchronisation se met à échouer :
 * il dit en une fois laquelle des sources est tombée.
 */
import { config } from '../config.ts';
import { requestJson } from '../lib/http.ts';

interface Candidate {
  source: string;
  url: string;
  headers?: Record<string, string>;
  /** Décrit pourquoi la candidate est ignorée, le cas échéant. */
  skip?: string;
}

function candidates(): Candidate[] {
  const list: Candidate[] = [
    // dotgg sert tout le catalogue en un appel : c'est la source principale.
    { source: 'dotgg', url: config.catalog.dotggUrl },

    // Les visuels viennent du site officiel Bandai, nommés d'après l'identifiant
    // de la carte. On vérifie une carte ordinaire et une illustration alternative,
    // dont le suffixe est sensible à la casse.
    {
      source: 'images',
      url: 'https://en.onepiece-cardgame.com/images/cardlist/card/OP01-001.png',
    },
    {
      source: 'images',
      url: 'https://en.onepiece-cardgame.com/images/cardlist/card/OP01-016_p1.png',
    },
  ];

  // Une URL passée en argument est sondée en plus : pratique pour vérifier une
  // adresse trouvée dans une documentation sans toucher au code.
  for (const url of process.argv.slice(2)) {
    if (/^https?:\/\//.test(url)) list.unshift({ source: 'argument', url });
  }


  list.push({
    source: 'apitcg',
    url: 'https://apitcg.com/api/one-piece/cards?limit=1&page=1',
    headers: config.catalog.apitcgKey ? { 'x-api-key': config.catalog.apitcgKey } : undefined,
    skip: config.catalog.apitcgKey ? undefined : 'APITCG_KEY absente de .env',
  });

  return list;
}

/** Tronque une valeur pour rester lisible dans un terminal. */
function short(value: unknown, max = 60): string {
  const text = value === null || value === undefined ? '∅' : String(value).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Décrit un enregistrement, qu'il soit un objet nommé ou une ligne colonnaire.
 * Dans le second cas (format « indexé » de dotgg), les noms de colonnes vivent
 * à part : c'est l'appariement colonne → valeur qui nous intéresse.
 */
function describeRecord(record: unknown, columns?: string[]): string {
  if (Array.isArray(record)) {
    return record
      .map((value, index) => `    ${index}. ${columns?.[index] ?? '?'} = ${short(value)}`)
      .join('\n');
  }
  if (record && typeof record === 'object') {
    return Object.entries(record as Record<string, unknown>)
      .map(([key, value]) => `    ${key} = ${short(value)}`)
      .join('\n');
  }
  return `    ${short(record)}`;
}

/** Résume la forme d'une réponse JSON, avec un exemple d'enregistrement complet. */
function describeJson(payload: unknown): string {
  if (Array.isArray(payload)) {
    return [
      `tableau de ${payload.length} éléments · exemple :`,
      describeRecord(payload[0]),
    ].join('\n');
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const parts = [`objet · clés : ${Object.keys(record).join(', ')}`];

    const columns = Array.isArray(record.names) ? (record.names as string[]) : undefined;
    if (columns) parts.push(`  names (${columns.length}) : ${columns.join(', ')}`);

    // Beaucoup d'APIs enveloppent la liste dans `data`, `cards` ou `results`.
    for (const key of ['data', 'cards', 'results', 'items']) {
      const value = record[key];
      if (Array.isArray(value)) {
        parts.push(`  ${key} : ${value.length} éléments · exemple :`);
        parts.push(describeRecord(value[0], columns));
      }
    }
    return parts.join('\n');
  }
  return `valeur ${typeof payload}`;
}

async function probe(candidate: Candidate): Promise<void> {
  const label = `[${candidate.source}] ${candidate.url}`;

  if (candidate.skip) {
    console.log(`—  ${label}\n   ignorée : ${candidate.skip}\n`);
    return;
  }

  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(candidate.url, {
      headers: { accept: 'application/json', ...candidate.headers },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const ms = Date.now() - started;
    const type = response.headers.get('content-type') ?? 'inconnu';
    const mark = response.ok ? 'OK' : 'KO';
    console.log(`${mark} ${label}\n   ${response.status} · ${type} · ${ms} ms`);

    const body = await response.text();
    if (!response.ok) {
      console.log(`   début du corps : ${body.slice(0, 160).replace(/\s+/g, ' ')}\n`);
      return;
    }
    if (type.startsWith('image/')) {
      console.log(`   image servie · ${(body.length / 1024).toFixed(0)} Ko\n`);
      return;
    }
    if (!type.includes('json')) {
      console.log(`   réponse non JSON : ${body.slice(0, 160).replace(/\s+/g, ' ')}\n`);
      return;
    }

    try {
      console.log(`   ${describeJson(JSON.parse(body)).split('\n').join('\n   ')}\n`);
    } catch {
      console.log(`   JSON illisible : ${body.slice(0, 160)}\n`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`KO ${label}\n   injoignable : ${reason}\n`);
  }
}

/**
 * Affiche les enregistrements bruts d'une carte et de ses illustrations.
 *
 * Sert à trancher les questions de classement : le champ `set` suit le numéro de
 * la carte, tandis que `CardSets` nomme les produits où l'illustration a
 * réellement été distribuée. Les comparer sur un cas concret évite d'inventer
 * une règle.
 */
async function inspectCard(query: string): Promise<void> {
  const payload = await requestJson<unknown>(config.catalog.dotggUrl, {
    headers: { accept: 'application/json' },
    timeoutMs: 60_000,
  });
  const list = (Array.isArray(payload) ? payload : ((payload as { data?: unknown[] }).data ?? [])) as Array<
    Record<string, unknown>
  >;

  const needle = query.toUpperCase();
  const matches = list.filter((card) => {
    const id = String(card.id ?? '').toUpperCase();
    const normal = String(card.id_normal ?? '').toUpperCase();
    return id === needle || normal === needle || id.startsWith(`${needle}_`);
  });

  console.log(`\n${matches.length} enregistrement(s) pour « ${query} ».\n`);
  for (const card of matches) {
    console.log(`  id         : ${card.id}`);
    console.log(`  id_normal  : ${card.id_normal}`);
    console.log(`  name       : ${card.name}`);
    console.log(`  rarity     : ${card.rarity}    cardType : ${card.cardType}`);
    console.log(`  set        : ${card.set}`);
    console.log(`  CardSets   : ${card.CardSets}`);
    console.log(`  language   : ${card.language}`);
    console.log('');
  }
}

async function main(): Promise<void> {
  // `npm run api:probe -- card OP01-001` inspecte une carte plutôt que sonder les
  // sources. Le sous-commande est un mot simple : npm capterait un argument
  // commençant par deux tirets avant qu'il n'arrive jusqu'ici.
  const args = process.argv.slice(2);
  if (args[0] === 'card') {
    for (const query of args.slice(1)) await inspectCard(query);
    return;
  }

  console.log('\nSondage des sources de catalogue.\n');
  for (const candidate of candidates()) {
    await probe(candidate);
  }
  console.log(
    'Transmets cette sortie telle quelle : elle indique quelle source répond\n' +
      'et sous quelle forme, ce qui suffit à brancher le connecteur correspondant.\n',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
