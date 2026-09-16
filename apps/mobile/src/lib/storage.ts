import type { CardCondition, CardLanguage, CollectionItem } from '@op/shared';
import * as SQLite from 'expo-sqlite';

/**
 * Base locale de l'appareil.
 *
 * Deux rôles :
 *  - stocker la collection, qui doit rester consultable et modifiable hors ligne ;
 *  - garder un cache du catalogue pour que l'app s'ouvre sans réseau.
 *
 * Le backend garde une copie de la collection (sauvegarde), mais l'appareil
 * reste la source de vérité côté utilisateur.
 */

let database: SQLite.SQLiteDatabase | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS collection_items (
  card_id        TEXT NOT NULL,
  condition      TEXT NOT NULL DEFAULT 'NM',
  language       TEXT NOT NULL DEFAULT 'EN',
  foil           INTEGER NOT NULL DEFAULT 0,
  quantity       INTEGER NOT NULL DEFAULT 1,
  acquired_price REAL,
  acquired_at    TEXT,
  notes          TEXT,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (card_id, condition, language, foil)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_cache (
  id         TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  cached_at  TEXT NOT NULL
);
`;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  const db = await SQLite.openDatabaseAsync('op-collection.db');
  await db.execAsync(SCHEMA);
  database = db;
  return db;
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

interface CollectionRow {
  card_id: string;
  condition: string;
  language: string;
  foil: number;
  quantity: number;
  acquired_price: number | null;
  acquired_at: string | null;
  notes: string | null;
  updated_at: string;
}

function toItem(row: CollectionRow): CollectionItem {
  return {
    cardId: row.card_id,
    condition: row.condition as CardCondition,
    language: row.language as CardLanguage,
    foil: row.foil === 1,
    quantity: row.quantity,
    acquiredPrice: row.acquired_price,
    acquiredAt: row.acquired_at,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export async function listCollection(): Promise<CollectionItem[]> {
  const db = await openDb();
  const rows = await db.getAllAsync<CollectionRow>(
    'SELECT * FROM collection_items ORDER BY updated_at DESC',
  );
  return rows.map(toItem);
}

/** Toutes les lignes d'une carte (une par état / langue / foil). */
export async function getCardEntries(cardId: string): Promise<CollectionItem[]> {
  const db = await openDb();
  const rows = await db.getAllAsync<CollectionRow>(
    'SELECT * FROM collection_items WHERE card_id = ? ORDER BY condition, language',
    cardId,
  );
  return rows.map(toItem);
}

export async function saveEntry(item: CollectionItem): Promise<void> {
  const db = await openDb();

  if (item.quantity <= 0) {
    await db.runAsync(
      'DELETE FROM collection_items WHERE card_id = ? AND condition = ? AND language = ? AND foil = ?',
      item.cardId,
      item.condition,
      item.language,
      item.foil ? 1 : 0,
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO collection_items
       (card_id, condition, language, foil, quantity, acquired_price, acquired_at, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(card_id, condition, language, foil) DO UPDATE SET
       quantity = excluded.quantity,
       acquired_price = excluded.acquired_price,
       acquired_at = excluded.acquired_at,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
    item.cardId,
    item.condition,
    item.language,
    item.foil ? 1 : 0,
    item.quantity,
    item.acquiredPrice,
    item.acquiredAt,
    item.notes,
    new Date().toISOString(),
  );
}

/** Ajoute (ou retire, avec un delta négatif) des exemplaires en un geste. */
export async function adjustQuantity(
  cardId: string,
  delta: number,
  options: { condition?: CardCondition; language?: CardLanguage; foil?: boolean } = {},
): Promise<void> {
  const condition = options.condition ?? 'NM';
  const language = options.language ?? 'EN';
  const foil = options.foil ?? false;

  const entries = await getCardEntries(cardId);
  const existing = entries.find(
    (e) => e.condition === condition && e.language === language && e.foil === foil,
  );

  await saveEntry({
    cardId,
    condition,
    language,
    foil,
    quantity: (existing?.quantity ?? 0) + delta,
    acquiredPrice: existing?.acquiredPrice ?? null,
    acquiredAt: existing?.acquiredAt ?? null,
    notes: existing?.notes ?? null,
    updatedAt: new Date().toISOString(),
  });
}

/** Quantités totales par carte : sert à afficher les pastilles dans les grilles. */
export async function ownedCounts(): Promise<Record<string, number>> {
  const db = await openDb();
  const rows = await db.getAllAsync<{ card_id: string; total: number }>(
    'SELECT card_id, SUM(quantity) AS total FROM collection_items GROUP BY card_id',
  );
  return Object.fromEntries(rows.map((r) => [r.card_id, r.total]));
}

// ---------------------------------------------------------------------------
// Cache catalogue
// ---------------------------------------------------------------------------

export async function cacheJson(key: string, payload: unknown): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO card_cache (id, payload, cached_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at`,
    key,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
}

export async function readCachedJson<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM card_cache WHERE id = ?',
    key,
  );
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}
