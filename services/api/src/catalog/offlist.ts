/**
 * Découverte automatique des cartes hors-liste.
 *
 * Une carte distribuée et jamais vendue — promo d'événement, prix de tournoi,
 * carte de boutique — n'est publiée par personne. Bandai ne liste que ce qu'il
 * met en vente, et les marketplaces indexent des produits, pas des goodies. La
 * promo du Musée Grévin en est l'exemple : OP13-001 n'a que deux impressions
 * dans la liste française, toutes deux dans le booster, et la carte du musée
 * porte « NOT FOR SALE ».
 *
 * Elle se revend pourtant. C'est la seule trace qu'elle laisse, et donc le seul
 * endroit où la chercher : les annonces. On interroge l'API officielle d'eBay
 * sur les termes qui désignent ce genre de tirage, on extrait de chaque titre le
 * code imprimé, et on retient les couples code + qualificatif qui reviennent
 * assez souvent pour ne pas être une annonce isolée mal titrée.
 *
 * Le résultat est écrit dans un fichier à part, jamais dans le complément tenu à
 * la main : ce qui est deviné doit rester distinguable de ce qui est su.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CardLanguage } from '@op/shared';
import { config } from '../config.ts';
import { EbayProvider } from '../prices/providers/ebay.ts';
import type { CatalogPayload } from './types.ts';

/**
 * Qualificatifs qui désignent un tirage hors-liste.
 *
 * Ils sont choisis pour être rares dans un titre d'annonce ordinaire : personne
 * n'écrit « grevin » ou « championship winner » pour vendre une commune. Le
 * terme sert à la fois de requête, de marqueur d'identité et de libellé.
 */
interface Qualifier {
  /** Fragment ajouté à l'identifiant de la carte : « OP13-001_grevin@FR ». */
  slug: string;
  /** Requête envoyée à eBay. */
  query: string;
  /** Nom du produit sous lequel regrouper ces cartes. */
  product: string;
}

const QUALIFIERS: Qualifier[] = [
  { slug: 'grevin', query: 'One Piece carte Grevin promo', product: 'Promos événements' },
  { slug: 'promo-fr', query: 'One Piece carte promo francaise exclusive', product: 'Promos événements' },
  { slug: 'winner', query: 'One Piece card championship winner promo', product: 'Prix de tournoi' },
  { slug: 'finalist', query: 'One Piece card championship finalist promo', product: 'Prix de tournoi' },
  { slug: 'regional', query: 'One Piece card regional tournament promo', product: 'Prix de tournoi' },
  { slug: 'store-battle', query: 'One Piece card store battle promo', product: 'Prix de tournoi' },
  { slug: 'treasure-cup', query: 'One Piece card treasure cup promo', product: 'Prix de tournoi' },
  { slug: 'jump-festa', query: 'One Piece card Jump Festa promo', product: 'Promos événements' },
  { slug: 'anniversary', query: 'One Piece card anniversary promo not for sale', product: 'Promos événements' },
];

const PRODUCTS: Record<string, { id: string; name: string }> = {
  'Promos événements': { id: 'HORS-LISTE-PROMO', name: 'Promos et événements' },
  'Prix de tournoi': { id: 'HORS-LISTE-TOURNOI', name: 'Prix de tournoi' },
};

/** Code imprimé, tel qu'il apparaît dans un titre d'annonce. */
function extractCode(title: string): string | null {
  const match = /\b([A-Z]{1,4}\d{0,2}-\d{3,4})\b/.exec(title.toUpperCase());
  return match ? match[1] : null;
}

/** Titres qui parlent d'autre chose qu'une carte à l'unité. */
const NOISE =
  /\b(lot|bundle|playset|display|booster box|sealed case|proxy|custom|orica|repack|sleeve|deck box|playmat|tapis)\b/i;

export interface OffListFinding {
  id: string;
  code: string;
  slug: string;
  product: string;
  language: CardLanguage;
  query: string;
  /** Nombre d'annonces distinctes ayant mené à cette carte. */
  listings: number;
  sample: string;
}

export function offListEnabled(): boolean {
  return config.catalog.offList && new EbayProvider().isConfigured();
}

export function offListPath(): string {
  return config.catalog.offListPath;
}

/**
 * Interroge eBay et rend les tirages hors-liste que le catalogue ignore.
 *
 * `known` contient les identifiants déjà en base : une carte n'est retenue que
 * si son code existe (le qualificatif porte sur une carte réelle) mais que ce
 * tirage-là n'y est pas.
 */
export async function discoverOffList(
  knownIds: Set<string>,
  knownCodes: Set<string>,
  onProgress: (message: string) => void = () => {},
): Promise<OffListFinding[]> {
  const ebay = new EbayProvider();
  const language = (config.ebay.marketplaceId === 'EBAY_FR' ? 'FR' : 'EN') as CardLanguage;

  // Un couple code + qualificatif ne compte que s'il revient : un vendeur qui
  // écrit « promo » au hasard sur une commune ne doit pas créer une carte.
  const counts = new Map<string, { finding: OffListFinding; titles: Set<string> }>();

  for (const qualifier of QUALIFIERS) {
    let listings: Array<{ title: string }> = [];
    try {
      listings = await ebay.searchListings(qualifier.query);
    } catch (error) {
      onProgress(
        `  ${qualifier.slug} : ${error instanceof Error ? error.message.split('\n')[0] : error}`,
      );
      continue;
    }

    for (const listing of listings) {
      if (NOISE.test(listing.title)) continue;

      const code = extractCode(listing.title);
      // Le code doit désigner une carte connue : sans cela, une coquille dans un
      // titre inventerait une carte de toutes pièces.
      if (!code || !knownCodes.has(code)) continue;

      const id = `${code}_${qualifier.slug}@${language}`;
      if (knownIds.has(id.toUpperCase())) continue;

      const entry = counts.get(id);
      if (entry) {
        entry.titles.add(listing.title);
      } else {
        counts.set(id, {
          titles: new Set([listing.title]),
          finding: {
            id,
            code,
            slug: qualifier.slug,
            product: qualifier.product,
            language,
            query: `${code} ${qualifier.slug.replace(/-/g, ' ')} One Piece`,
            listings: 0,
            sample: listing.title,
          },
        });
      }
    }

    onProgress(`  ${qualifier.slug} : ${listings.length} annonce(s) examinée(s)`);
  }

  return [...counts.values()]
    .map(({ finding, titles }) => ({ ...finding, listings: titles.size }))
    .filter((finding) => finding.listings >= config.catalog.offListMinListings)
    .sort((a, b) => b.listings - a.listings);
}

/** Écrit les trouvailles, en conservant celles des passages précédents. */
export function saveOffList(findings: OffListFinding[]): void {
  const path = offListPath();
  const existing = readOffListFile();

  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  for (const finding of findings) byId.set(finding.id, finding);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        _lisezmoi:
          'Fichier produit automatiquement par la découverte eBay. ' +
          'Ne pas éditer à la main : il est réécrit à chaque synchronisation. ' +
          'Les cartes saisies à la main vont dans supplement.json.',
        generatedAt: new Date().toISOString(),
        cards: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function readOffListFile(): OffListFinding[] {
  const path = offListPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { cards?: OffListFinding[] };
    return parsed.cards ?? [];
  } catch {
    // Un fichier illisible ne doit pas bloquer la synchronisation : il sera
    // réécrit au passage suivant.
    return [];
  }
}

/**
 * Charge les trouvailles sous la forme attendue par la synchronisation.
 *
 * Elles sont volontairement pauvres — code, nom du tirage, requête de cotation.
 * Ce qu'on sait d'une carte hors-liste tient dans son annonce ; inventer un
 * effet ou une puissance serait pire que de les laisser vides.
 */
export function loadOffList(): CatalogPayload | null {
  const findings = readOffListFile();
  if (findings.length === 0) return null;

  const products = new Map<string, { id: string; name: string }>();
  for (const finding of findings) {
    const product = PRODUCTS[finding.product] ?? {
      id: 'HORS-LISTE',
      name: 'Cartes hors-liste',
    };
    products.set(product.id, product);
  }

  return {
    sets: [...products.values()].map((product) => ({
      id: product.id,
      name: product.name,
      kind: 'promo' as const,
      code: product.id,
      releaseDate: null,
      imageUrl: null,
    })),
    cards: findings.map((finding) => ({
      id: finding.id.toUpperCase(),
      code: finding.code,
      name: `${finding.code} — ${finding.slug.replace(/-/g, ' ')}`,
      setId: (PRODUCTS[finding.product] ?? { id: 'HORS-LISTE' }).id,
      setName: (PRODUCTS[finding.product] ?? { name: 'Cartes hors-liste' }).name,
      category: 'CHARACTER' as const,
      rarity: 'P',
      colors: [],
      cost: null,
      power: null,
      counter: null,
      life: null,
      attributes: [],
      types: [],
      effect: null,
      trigger: null,
      imageUrl: null,
      artVariant: 0,
      language: finding.language,
    })),
    links: findings.map((finding) => ({
      cardId: finding.id.toUpperCase(),
      marketplace: 'ebay' as const,
      externalId: null,
      query: finding.query,
      url: null,
    })),
  };
}
