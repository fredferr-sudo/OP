import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';

/**
 * Base de données du backend.
 *
 * On utilise `node:sqlite`, le module SQLite intégré à Node (22.5+), plutôt qu'une
 * bibliothèque native comme better-sqlite3 : ces dernières demandent un binaire
 * précompilé pour chaque version de Node et chaque plateforme, et à défaut une
 * chaîne de compilation C++ (Python, Visual Studio Build Tools sous Windows).
 * Le module intégré supprime cette dépendance : `npm install` n'a plus rien à
 * compiler, quelle que soit la machine.
 */

const here = dirname(fileURLToPath(import.meta.url));

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;

  mkdirSync(dirname(config.databasePath), { recursive: true });
  const connection = new DatabaseSync(config.databasePath);
  connection.exec('PRAGMA journal_mode = WAL');
  connection.exec('PRAGMA foreign_keys = ON');
  connection.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

  instance = connection;
  return connection;
}

/**
 * Exécute `work` dans une transaction, avec annulation en cas d'erreur.
 *
 * `node:sqlite` n'offre pas d'équivalent à `db.transaction()` de better-sqlite3 :
 * on pilote BEGIN / COMMIT / ROLLBACK à la main. Les transactions imbriquées
 * sont ignorées (seule la plus externe valide), ce qui suffit ici.
 */
export function transaction<T>(work: () => T): T {
  const connection = db();
  if (inTransaction) return work();

  connection.exec('BEGIN');
  inTransaction = true;
  try {
    const result = work();
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  } finally {
    inTransaction = false;
  }
}

let inTransaction = false;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** SQLite ne connaît pas les booléens : il faut les convertir explicitement. */
export function bool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

/**
 * Paramètres d'une requête : soit nommés (`@cle`), soit positionnels (`?`).
 * node:sqlite refuse une clé nommée qui ne figure pas dans la requête, ainsi que
 * toute valeur `undefined` — les appelants passent donc des objets explicites.
 */
export type Params = Record<string, SQLInputValue> | SQLInputValue[];

/**
 * Les trois helpers ci-dessous encapsulent la conversion de type.
 * node:sqlite décrit ses lignes comme `Record<string, SQLOutputValue>` ; chaque
 * appelant sait quelle forme sa requête renvoie, et l'annonce en paramètre de type.
 */
export function selectAll<T>(sql: string, params?: Params): T[] {
  const statement = db().prepare(sql);
  const rows =
    params === undefined
      ? statement.all()
      : Array.isArray(params)
        ? statement.all(...params)
        : statement.all(params);
  return rows as unknown as T[];
}

export function selectOne<T>(sql: string, params?: Params): T | null {
  const statement = db().prepare(sql);
  const row =
    params === undefined
      ? statement.get()
      : Array.isArray(params)
        ? statement.get(...params)
        : statement.get(params);
  return (row ?? null) as unknown as T | null;
}

export function run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
  const statement = db().prepare(sql);
  const result =
    params === undefined
      ? statement.run()
      : Array.isArray(params)
        ? statement.run(...params)
        : statement.run(params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}
