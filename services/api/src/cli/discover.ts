/**
 * Détection automatique des cartes absentes du catalogue.
 *
 *   npm run api:discover            # rapport seul
 *   npm run api:discover -- --write # écrit aussi le complément
 *
 * La source principale ignore certaines cartes — exclusivités régionales,
 * raretés récentes. Cette commande confronte le catalogue local à toutes les
 * sources secondaires configurées et rapporte, pour chacune, ce qu'elle
 * apporterait de plus.
 *
 * Trois sources sont interrogées si elles sont disponibles :
 *  - apitcg.com, dont la clé est gratuite et l'inscription ouverte ;
 *  - TCGplayer, dont l'API officielle donne le catalogue complet de la
 *    marketplace : c'est là que figurent les cartes qu'aucune liste d'éditeur
 *    ne publie, puisqu'elle référence ce qui se vend et non ce qui est annoncé ;
 *  - Cardmarket, dont le catalogue européen contiendrait les exclusivités
 *    françaises, mais dont les demandes d'accès API sont fermées à ce jour.
 *
 * Aucune n'étant garantie, la commande travaille avec ce qui répond et le dit.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.ts';
import { db, selectAll } from '../db/index.ts';
import { ApiTcgProvider } from '../catalog/providers/apitcg.ts';
import { supplementPath } from '../catalog/supplement.ts';
import {
  cardmarketConfigured,
  cardmarketGameId,
  cardmarketGet,
} from '../prices/providers/cardmarket.ts';
import { TcgPlayerProvider } from '../prices/providers/tcgplayer.ts';

interface Expansion {
  idExpansion: number;
  enName?: string;
  abbreviation?: string;
  releaseDate?: string;
}

interface Single {
  idProduct: number;
  enName?: string;
  number?: string;
  website?: string;
  rarity?: string;
}

/** Code imprimé d'une carte, tel qu'il apparaît dans un nom ou un numéro. */
function extractCode(...candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    const match = /\b([A-Z]{1,4}\d*-\d{3,4}[A-Za-z0-9_]*)\b/.exec(String(candidate ?? '').toUpperCase());
    if (match) return match[1];
  }
  return null;
}

interface Found {
  code: string;
  name: string;
  setId: string;
  setName: string;
  cmid: number | null;
  url: string | null;
  rarity: string | null;
  source: string;
}

/** apitcg.com : clé gratuite, inscription ouverte. */
async function fromApiTcg(known: Set<string>): Promise<Found[]> {
  const payload = await new ApiTcgProvider().fetchAll();
  const found: Found[] = [];

  for (const card of payload.cards) {
    const code = card.code.toUpperCase();
    if (!code || known.has(code)) continue;
    known.add(code);
    found.push({
      code,
      name: card.name,
      setId: card.setId,
      setName: card.setName,
      cmid: null,
      url: null,
      rarity: card.rarity,
      source: 'apitcg',
    });
  }
  return found;
}

/**
 * TCGplayer : catalogue complet, par l'API officielle.
 *
 * Une marketplace voit ce qu'aucune liste d'éditeur ne publie — prix de
 * tournoi, promos d'événement, cartes distribuées en boutique — parce qu'elle
 * référence ce qui se vend, pas ce qui est annoncé. TCGplayer ouvre cet
 * inventaire à qui demande une clé, ce qui rend inutile d'aller le prendre
 * ailleurs sans permission.
 */
async function fromTcgPlayer(known: Set<string>): Promise<Found[]> {
  const provider = new TcgPlayerProvider();
  const found: Found[] = [];
  let seen = 0;

  for await (const { product, group } of provider.walkCatalog()) {
    seen += 1;

    // Un produit scellé — display, deck, coffret — n'est pas une carte et n'a
    // pas de numéro imprimé : l'absence de code suffit à l'écarter.
    const number = product.extendedData?.find((field) => field.name === 'Number')?.value;
    const code = extractCode(number, product.cleanName, product.name);
    if (!code || known.has(code)) continue;

    known.add(code);
    found.push({
      code,
      name: product.cleanName ?? product.name,
      setId: code.split('-')[0] ?? '?',
      setName: group,
      cmid: null,
      url: product.url ?? null,
      rarity: product.extendedData?.find((field) => field.name === 'Rarity')?.value ?? null,
      source: 'tcgplayer',
    });
  }

  console.log(`  TCGplayer : ${seen} produits parcourus.`);
  return found;
}

async function fromCardmarket(known: Set<string>): Promise<Found[]> {
  const found: Found[] = [];
  const gameId = await cardmarketGameId();
  const expansionPayload = await cardmarketGet<{ expansion?: Expansion[] }>(
    `/games/${gameId}/expansions`,
  );
  const expansions = expansionPayload.expansion ?? [];
  console.log(`  Cardmarket : ${expansions.length} extensions à parcourir.`);

  for (const expansion of expansions) {
    const setName = (expansion.enName ?? '').trim() || `Extension ${expansion.idExpansion}`;
    const setId = (expansion.abbreviation ?? '').trim().toUpperCase() || `CM${expansion.idExpansion}`;

    let singles: Single[] = [];
    try {
      const payload = await cardmarketGet<{ single?: Single[] }>(
        `/expansions/${expansion.idExpansion}/singles`,
      );
      singles = payload.single ?? [];
    } catch (error) {
      console.log(`  ! ${setName} : ${error instanceof Error ? error.message.split('\n')[0] : error}`);
      continue;
    }

    for (const single of singles) {
      const code = extractCode(single.number, single.enName);
      // Sans code lisible, on ne peut pas confronter la carte au catalogue :
      // un scellé ou un accessoire n'est pas une carte.
      if (!code || known.has(code)) continue;

      known.add(code);
      found.push({
        code,
        name: (single.enName ?? code).trim(),
        setId,
        setName,
        cmid: single.idProduct,
        url: single.website ? `https://www.cardmarket.com${single.website}` : null,
        rarity: single.rarity ?? null,
        source: 'cardmarket',
      });
    }
  }

  return found;
}

async function main(): Promise<void> {
  db();
  const write = process.argv.slice(2).includes('--write');

  // Ce que le catalogue local connaît déjà, par code imprimé. L'ensemble grandit
  // au fil des sources, pour qu'une carte trouvée deux fois ne soit comptée
  // qu'une.
  const known = new Set(
    selectAll<{ code: string }>('SELECT DISTINCT code FROM cards').map((row) =>
      row.code.toUpperCase(),
    ),
  );
  console.log(`\nCatalogue local : ${known.size} codes connus.\n`);

  const sources: Array<{ name: string; run: () => Promise<Found[]>; skip?: string }> = [
    {
      name: 'apitcg',
      run: () => fromApiTcg(known),
      skip: config.catalog.apitcgKey
        ? undefined
        : 'APITCG_KEY absente de .env — la clé est gratuite sur apitcg.com',
    },
    {
      name: 'tcgplayer',
      run: () => fromTcgPlayer(known),
      skip:
        config.tcgplayer.publicKey && config.tcgplayer.privateKey
          ? undefined
          : 'clés absentes de .env — le portail développeur TCGplayer les délivre gratuitement',
    },
    {
      name: 'cardmarket',
      run: () => fromCardmarket(known),
      skip: cardmarketConfigured()
        ? undefined
        : "jetons absents de .env — Cardmarket n'accepte plus de demandes d'accès API",
    },
  ];

  const missing: Found[] = [];
  for (const source of sources) {
    if (source.skip) {
      console.log(`—  ${source.name} : ignorée (${source.skip})`);
      continue;
    }
    try {
      const found = await source.run();
      missing.push(...found);
      console.log(`OK ${source.name} : ${found.length} carte(s) que le catalogue ignore`);
    } catch (error) {
      console.log(
        `KO ${source.name} : ${error instanceof Error ? error.message.split('\n')[0] : error}`,
      );
    }
  }

  console.log(`\n${missing.length} carte(s) absente(s) au total.`);

  if (missing.length === 0) {
    console.log(
      'Rien à ajouter. Si tu sais des cartes manquantes, elles ne sont dans aucune\n' +
        'des sources interrogées : décris-les dans le complément (voir le README).\n',
    );
    return;
  }

  for (const card of missing.slice(0, 25)) {
    console.log(
      `  ${card.code.padEnd(14)} ${card.name.slice(0, 30).padEnd(32)} ` +
        `${card.setName.slice(0, 24).padEnd(26)} ${card.source}`,
    );
  }
  if (missing.length > 25) console.log(`  … et ${missing.length - 25} autres.`);

  if (!write) {
    console.log('\nRelance avec « -- --write » pour les écrire dans le complément.\n');
    return;
  }

  // On repart du complément existant pour ne rien perdre de ce qui y a été saisi.
  const path = supplementPath();
  const existing = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { sets?: unknown[]; cards?: unknown[] })
    : {};
  const sets = [...((existing.sets as Array<{ id: string }>) ?? [])];
  const cards = [...((existing.cards as Array<{ id: string }>) ?? [])];
  const haveSet = new Set(sets.map((set) => set.id.toUpperCase()));
  const haveCard = new Set(cards.map((card) => card.id.toUpperCase()));

  for (const card of missing) {
    if (!haveSet.has(card.setId)) {
      haveSet.add(card.setId);
      sets.push({ id: card.setId, name: card.setName } as { id: string });
    }
    if (haveCard.has(card.code)) continue;
    haveCard.add(card.code);
    cards.push({
      id: card.code,
      name: card.name,
      setId: card.setId,
      rarity: card.rarity,
      // Renseigné seulement quand la source le fournit : un identifiant produit
      // connu évite tout rapprochement par nom au moment de relever le prix.
      ...(card.cmid ? { cardmarketId: String(card.cmid), cardmarketUrl: card.url } : {}),
      // La langue n'est pas déductible d'un catalogue de vente : à corriger à la
      // main si la carte est une exclusivité d'une autre langue.
    } as unknown as { id: string });
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ sets, cards }, null, 2)}\n`, 'utf8');
  console.log(`\nComplément écrit : ${path}`);
  console.log('Relance « npm run api:sync -- catalog » pour l\'intégrer.\n');
}

main().catch((error) => {
  console.error(`\nDétection interrompue : ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
