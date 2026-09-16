-- Schéma de la base locale du backend.
-- SQLite est largement suffisant ici : le catalogue complet du jeu représente
-- quelques milliers de lignes, et l'historique de prix ~3 relevés/carte/jour.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sets (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  code          TEXT,
  release_date  TEXT,
  image_url     TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  set_id       TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  rarity       TEXT,
  colors       TEXT NOT NULL DEFAULT '[]',
  cost         INTEGER,
  power        INTEGER,
  counter      INTEGER,
  life         INTEGER,
  attributes   TEXT NOT NULL DEFAULT '[]',
  types        TEXT NOT NULL DEFAULT '[]',
  effect       TEXT,
  trigger      TEXT,
  image_url    TEXT,
  art_variant  INTEGER NOT NULL DEFAULT 0,
  language     TEXT NOT NULL DEFAULT 'EN',
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_set ON cards(set_id);
CREATE INDEX IF NOT EXISTS idx_cards_code ON cards(code);
CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);

-- Recherche plein texte sur le nom, l'effet et les types.
CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
  id UNINDEXED,
  code,
  name,
  effect,
  types,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Correspondance carte <-> produit chez une marketplace.
-- C'est la pièce centrale : sans elle on ne sait pas quel produit interroger.
CREATE TABLE IF NOT EXISTS market_links (
  card_id      TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  marketplace  TEXT NOT NULL,
  external_id  TEXT,            -- idProduct Cardmarket / productId TCGplayer
  external_name TEXT,
  query        TEXT,            -- requête utilisée pour eBay (pas d'ID produit)
  url          TEXT,
  confidence   REAL NOT NULL DEFAULT 0,
  matched_at   TEXT NOT NULL,
  PRIMARY KEY (card_id, marketplace)
);

-- Un relevé = une carte, une marketplace, un jour.
CREATE TABLE IF NOT EXISTS price_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  marketplace   TEXT NOT NULL,
  captured_on   TEXT NOT NULL,   -- YYYY-MM-DD
  captured_at   TEXT NOT NULL,   -- ISO datetime
  currency      TEXT NOT NULL,
  low           REAL,
  market        REAL,
  avg1          REAL,
  avg7          REAL,
  avg30         REAL,
  listing_count INTEGER,
  foil          INTEGER NOT NULL DEFAULT 0,
  url           TEXT,
  -- 1 = point reconstruit depuis les moyennes glissantes, 0 = relevé réel.
  estimated     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (card_id, marketplace, foil, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_card ON price_snapshots(card_id, marketplace, captured_on DESC);

-- Collection de l'utilisateur (sauvegarde serveur ; l'app garde sa copie locale).
CREATE TABLE IF NOT EXISTS collection_items (
  card_id        TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
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

-- Journal des synchronisations, pour savoir ce qui tourne et ce qui échoue.
CREATE TABLE IF NOT EXISTS sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,     -- catalog | prices
  source      TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,     -- running | success | error
  processed   INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  message     TEXT
);
