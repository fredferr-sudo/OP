import 'dotenv/config';
import { resolve } from 'node:path';

function str(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

/**
 * Comme `str`, mais une valeur vide reste une valeur.
 *
 * `str` traite « vide » comme « absent » et rend sa valeur par défaut, ce qui
 * convient à une clé d'API mais pas à une liste : `CATALOG_PRINTINGS=` veut dire
 * « aucune édition régionale », et se voyait répondre « FR,JP ».
 */
function list(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function num(key: string, fallback: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: num('PORT', 4000),
  host: str('HOST', '0.0.0.0'),
  databasePath: resolve(process.cwd(), str('DATABASE_PATH', './data/op.db')),

  scheduler: {
    enabled: bool('SCHEDULER_ENABLED', true),
    priceCron: str('PRICE_CRON', '15 4 * * *'),
    catalogCron: str('CATALOG_CRON', '0 3 * * 1'),
  },

  catalog: {
    provider: str('CATALOG_PROVIDER', 'dotgg') as 'dotgg' | 'apitcg' | 'local',
    apitcgKey: str('APITCG_KEY'),
    dotggUrl: str('DOTGG_URL', 'https://api.dotgg.gg/cgfw/getcards?game=onepiece'),
    // Sert uniquement de dictionnaire de noms de produits en anglais.
    optcgBaseUrl: str('OPTCG_BASE_URL', 'https://optcgapi.com/api'),
    // Cartes que les sources internationales ignorent : exclusivités régionales,
    // promos d'événements. Fusionné après elles, donc jamais écrasé.
    supplementPath: resolve(process.cwd(), str('SUPPLEMENT_PATH', './data/supplement.json')),

    // Éditions ajoutées au catalogue global, au-delà de l'anglais. Les listes
    // viennent des sites officiels Bandai de chaque région, via la copie
    // versionnée « punk-records ». Vide = catalogue global seul.
    printings: list('CATALOG_PRINTINGS', 'FR,JP'),
    punkRecordsUrl: str('PUNK_RECORDS_URL', 'https://github.com/buhbbl/punk-records.git'),
    // Copie locale du dépôt : conservée entre deux synchronisations, pour ne
    // retélécharger que les cartes modifiées.
    punkRecordsDir: resolve(
      process.cwd(),
      str('PUNK_RECORDS_DIR', './data/sources/punk-records'),
    ),

    // Découverte automatique des cartes qu'aucune liste ne publie — promos
    // d'événement, prix de tournoi — par les annonces eBay. Demande les clés
    // eBay ; sans elles l'option est sans effet.
    offList: bool('CATALOG_OFFLIST', true),
    // Nombre d'annonces distinctes exigé avant de retenir un tirage : un titre
    // isolé et mal rédigé ne doit pas créer une carte.
    offListMinListings: num('CATALOG_OFFLIST_MIN_LISTINGS', 3),
    offListPath: resolve(process.cwd(), str('OFFLIST_PATH', './data/discovered.json')),
  },

  cardmarket: {
    appToken: str('CARDMARKET_APP_TOKEN'),
    appSecret: str('CARDMARKET_APP_SECRET'),
    accessToken: str('CARDMARKET_ACCESS_TOKEN'),
    accessSecret: str('CARDMARKET_ACCESS_SECRET'),
    baseUrl: str('CARDMARKET_BASE_URL', 'https://api.cardmarket.com/ws/v2.0/output.json'),
    // État minimum retenu pour le prix de référence : c'est le premier prix
    // affiché sur la fiche produit une fois ce filtre appliqué.
    minCondition: str('CARDMARKET_MIN_CONDITION', 'NM'),
    // Vide = toutes langues, comme le filtre par défaut du site.
    languageId: str('CARDMARKET_LANGUAGE_ID'),
    // Nombre d'offres récupérées auprès de l'API.
    articleSample: num('CARDMARKET_ARTICLE_SAMPLE', 30),
    // Parmi elles, nombre des moins chères dont on prend la médiane.
    priceSample: num('CARDMARKET_PRICE_SAMPLE', 3),
  },

  tcgplayer: {
    publicKey: str('TCGPLAYER_PUBLIC_KEY'),
    privateKey: str('TCGPLAYER_PRIVATE_KEY'),
    baseUrl: 'https://api.tcgplayer.com',
  },

  ebay: {
    clientId: str('EBAY_CLIENT_ID'),
    clientSecret: str('EBAY_CLIENT_SECRET'),
    marketplaceId: str('EBAY_MARKETPLACE_ID', 'EBAY_FR'),
    baseUrl: str('EBAY_BASE_URL', 'https://api.ebay.com'),
  },
} as const;

export type Config = typeof config;
