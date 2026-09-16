import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;

  mkdirSync(dirname(config.databasePath), { recursive: true });
  const connection = new Database(config.databasePath);
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));

  instance = connection;
  return connection;
}

/** Enveloppe une fonction dans une transaction SQLite. */
export function transaction<T extends unknown[], R>(fn: (...args: T) => R): (...args: T) => R {
  return db().transaction(fn) as unknown as (...args: T) => R;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}
