import 'dotenv/config';
import { resolve } from 'node:path';

function str(key: string, fallback = ''): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
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
  },

  cardmarket: {
    appToken: str('CARDMARKET_APP_TOKEN'),
    appSecret: str('CARDMARKET_APP_SECRET'),
    accessToken: str('CARDMARKET_ACCESS_TOKEN'),
    accessSecret: str('CARDMARKET_ACCESS_SECRET'),
    baseUrl: str('CARDMARKET_BASE_URL', 'https://api.cardmarket.com/ws/v2.0/output.json'),
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
