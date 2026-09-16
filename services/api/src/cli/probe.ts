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
    { source: 'dotgg', url: 'https://api.dotgg.gg/cgfw/getcards?game=onepiece&mode=indexed' },
    { source: 'dotgg', url: 'https://api.dotgg.gg/cgfw/getcards?game=onepiece' },

    // optcgapi expose les produits mais pas de liste globale de cartes :
    // on cherche par quel chemin obtenir les cartes d'une extension ou d'un deck.
    { source: 'optcgapi', url: 'https://optcgapi.com/api/allSets/' },
    { source: 'optcgapi', url: 'https://optcgapi.com/api/allSets/OP01/' },
    { source: 'optcgapi', url: 'https://optcgapi.com/api/allSets/OP-01/' },
    { source: 'optcgapi', url: 'https://optcgapi.com/api/allDecks/' },
    { source: 'optcgapi', url: 'https://optcgapi.com/api/allDecks/ST01/' },
    { source: 'optcgapi', url: 'https://optcgapi.com/api/allDecks/ST-01/' },
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

async function main(): Promise<void> {
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
