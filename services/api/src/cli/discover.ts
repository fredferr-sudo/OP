/**
 * Détection automatique des cartes absentes du catalogue.
 *
 *   npm run api:discover            # rapport seul
 *   npm run api:discover -- --write # écrit aussi le complément
 *
 * Les sources internationales ignorent les exclusivités régionales. Cardmarket,
 * lui, est une place de marché européenne : son catalogue contient forcément ce
 * qui se vend en Europe, exclusivités françaises comprises. On énumère donc ses
 * produits One Piece, on les confronte au catalogue local, et ce qui manque est
 * écrit dans le complément — avec son identifiant produit, ce qui donne au
 * passage le prix sans aucun rapprochement approximatif.
 *
 * Nécessite les jetons Cardmarket (compte > Account > API).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { db, selectAll } from '../db/index.ts';
import { supplementPath } from '../catalog/supplement.ts';
import {
  cardmarketConfigured,
  cardmarketGameId,
  cardmarketGet,
} from '../prices/providers/cardmarket.ts';

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

async function main(): Promise<void> {
  if (!cardmarketConfigured()) {
    console.log(
      '\nLes jetons Cardmarket manquent dans services/api/.env.\n' +
        'Ils se créent depuis ton compte Cardmarket (Account > API) et sont gratuits.\n' +
        "Sans eux, cette détection ne peut pas s'appuyer sur un catalogue européen.\n",
    );
    process.exit(1);
  }

  db();
  const write = process.argv.slice(2).includes('--write');

  // Ce que le catalogue local connaît déjà, par code imprimé.
  const known = new Set(
    selectAll<{ code: string }>('SELECT DISTINCT code FROM cards').map((row) =>
      row.code.toUpperCase(),
    ),
  );
  console.log(`\nCatalogue local : ${known.size} codes connus.`);

  const gameId = await cardmarketGameId();
  const expansionPayload = await cardmarketGet<{ expansion?: Expansion[] }>(
    `/games/${gameId}/expansions`,
  );
  const expansions = expansionPayload.expansion ?? [];
  console.log(`Cardmarket : ${expansions.length} extensions à parcourir.\n`);

  const missing: Array<{
    code: string;
    name: string;
    setId: string;
    setName: string;
    cmid: number;
    url: string | null;
    rarity: string | null;
  }> = [];
  let scanned = 0;

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

    scanned += singles.length;
    let newHere = 0;

    for (const single of singles) {
      const code = extractCode(single.number, single.enName);
      // Sans code lisible, on ne peut pas confronter la carte au catalogue :
      // l'ajouter à l'aveugle créerait des doublons.
      if (!code || known.has(code)) continue;

      known.add(code);
      newHere += 1;
      missing.push({
        code,
        name: (single.enName ?? code).trim(),
        setId,
        setName,
        cmid: single.idProduct,
        url: single.website ? `https://www.cardmarket.com${single.website}` : null,
        rarity: single.rarity ?? null,
      });
    }

    if (newHere > 0) console.log(`  + ${setName.padEnd(38)} ${newHere} carte(s) absente(s)`);
  }

  console.log(`\n${scanned} produits parcourus · ${missing.length} carte(s) absente(s) du catalogue.`);

  if (missing.length === 0) {
    console.log('Rien à ajouter : le catalogue couvre tout ce que Cardmarket vend.\n');
    return;
  }

  for (const card of missing.slice(0, 20)) {
    console.log(`  ${card.code.padEnd(14)} ${card.name.slice(0, 32).padEnd(34)} ${card.setName.slice(0, 28)}`);
  }
  if (missing.length > 20) console.log(`  … et ${missing.length - 20} autres.`);

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
      cardmarketId: String(card.cmid),
      cardmarketUrl: card.url,
      // La langue n'est pas déductible : Cardmarket vend un produit, et c'est
      // l'offre qui porte une langue. À corriger à la main si besoin.
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
