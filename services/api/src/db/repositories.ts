import type { SQLInputValue } from 'node:sqlite';
import type {
  Card,
  CardQuery,
  CardSet,
  CollectionItem,
  CollectionStats,
  Marketplace,
  Paginated,
  PriceHistory,
  PricePoint,
  PriceQuote,
  SetKind,
} from '@op/shared';
import { bool, nowIso, run, selectAll, selectOne, transaction } from './index.js';

// ---------------------------------------------------------------------------
// Lignes brutes SQLite
// ---------------------------------------------------------------------------

interface CardRow {
  id: string;
  code: string;
  name: string;
  set_id: string;
  set_name: string;
  set_kind: string;
  category: string;
  rarity: string | null;
  colors: string;
  cost: number | null;
  power: number | null;
  counter: number | null;
  life: number | null;
  attributes: string;
  types: string;
  effect: string | null;
  trigger: string | null;
  image_url: string | null;
  art_variant: number;
  language: string;
  updated_at: string;
}

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    setId: row.set_id,
    setName: row.set_name,
    setKind: row.set_kind as SetKind,
    category: row.category as Card['category'],
    rarity: row.rarity,
    colors: JSON.parse(row.colors),
    cost: row.cost,
    power: row.power,
    counter: row.counter,
    life: row.life,
    attributes: JSON.parse(row.attributes),
    types: JSON.parse(row.types),
    effect: row.effect,
    trigger: row.trigger,
    imageUrl: row.image_url,
    artVariant: row.art_variant,
    language: row.language as Card['language'],
    updatedAt: row.updated_at,
  };
}

const CARD_SELECT = `
  SELECT c.*, s.name AS set_name, s.kind AS set_kind
  FROM cards c
  JOIN sets s ON s.id = c.set_id
`;

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

export function listSets(): CardSet[] {
  const rows = selectAll<{
    id: string;
    name: string;
    kind: string;
    code: string | null;
    release_date: string | null;
    image_url: string | null;
    card_count: number;
  }>(
    `SELECT s.*, (SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id) AS card_count
     FROM sets s
     ORDER BY
       CASE s.kind
         WHEN 'booster' THEN 0 WHEN 'starter' THEN 1 WHEN 'special' THEN 2
         WHEN 'promo' THEN 3 WHEN 'tournament' THEN 4 ELSE 5 END,
       COALESCE(s.release_date, '9999') DESC, s.id DESC`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as SetKind,
    code: row.code,
    releaseDate: row.release_date,
    imageUrl: row.image_url,
    cardCount: row.card_count,
  }));
}

export function upsertSet(set: Omit<CardSet, 'cardCount'>): void {
  run(
    `INSERT INTO sets (id, name, kind, code, release_date, image_url, updated_at)
       VALUES (@id, @name, @kind, @code, @releaseDate, @imageUrl, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         code = excluded.code,
         release_date = COALESCE(excluded.release_date, sets.release_date),
         image_url = COALESCE(excluded.image_url, sets.image_url),
         updated_at = excluded.updated_at`,
    {
      id: set.id,
      name: set.name,
      kind: set.kind,
      code: set.code ?? null,
      releaseDate: set.releaseDate ?? null,
      imageUrl: set.imageUrl ?? null,
      updatedAt: nowIso(),
    },
  );
}

// ---------------------------------------------------------------------------
// Cartes
// ---------------------------------------------------------------------------

export function upsertCard(card: Omit<Card, 'setName' | 'setKind' | 'updatedAt'>): void {
  // Les paramètres sont listés un par un : node:sqlite rejette toute clé qui ne
  // correspond pas à un paramètre nommé de la requête, et tout `undefined`.
  const payload = {
    id: card.id,
    code: card.code,
    name: card.name,
    setId: card.setId,
    category: card.category,
    rarity: card.rarity ?? null,
    colors: JSON.stringify(card.colors),
    cost: card.cost ?? null,
    power: card.power ?? null,
    counter: card.counter ?? null,
    life: card.life ?? null,
    attributes: JSON.stringify(card.attributes),
    types: JSON.stringify(card.types),
    effect: card.effect ?? null,
    trigger: card.trigger ?? null,
    imageUrl: card.imageUrl ?? null,
    artVariant: card.artVariant,
    language: card.language,
    updatedAt: nowIso(),
  };

  run(
    `INSERT INTO cards (
         id, code, name, set_id, category, rarity, colors, cost, power, counter, life,
         attributes, types, effect, trigger, image_url, art_variant, language, updated_at
       ) VALUES (
         @id, @code, @name, @setId, @category, @rarity, @colors, @cost, @power, @counter, @life,
         @attributes, @types, @effect, @trigger, @imageUrl, @artVariant, @language, @updatedAt
       )
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code, name = excluded.name, set_id = excluded.set_id,
         category = excluded.category, rarity = excluded.rarity, colors = excluded.colors,
         cost = excluded.cost, power = excluded.power, counter = excluded.counter,
         life = excluded.life, attributes = excluded.attributes, types = excluded.types,
         effect = excluded.effect, trigger = excluded.trigger,
         image_url = COALESCE(excluded.image_url, cards.image_url),
         art_variant = excluded.art_variant, language = excluded.language,
         updated_at = excluded.updated_at`,
    payload,
  );

  // L'index FTS est maintenu à la main (fts5 externe non contentless pour rester simple).
  run('DELETE FROM cards_fts WHERE id = ?', [card.id]);
  run('INSERT INTO cards_fts (id, code, name, effect, types) VALUES (?, ?, ?, ?, ?)', [
    card.id,
    card.code,
    card.name,
    card.effect ?? '',
    card.types.join(' '),
  ]);
}

export function getCard(id: string): Card | null {
  const row = selectOne<CardRow>(`${CARD_SELECT} WHERE c.id = ?`, [id]);
  return row ? toCard(row) : null;
}

/** Toutes les illustrations partageant le même code imprimé. */
export function getCardVariants(code: string): Card[] {
  const rows = selectAll<CardRow>(`${CARD_SELECT} WHERE c.code = ? ORDER BY c.art_variant`, [code]);
  return rows.map(toCard);
}

export function getCardsByIds(ids: string[]): Card[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = selectAll<CardRow>(`${CARD_SELECT} WHERE c.id IN (${placeholders})`, ids);
  return rows.map(toCard);
}

export function queryCards(query: CardQuery): Paginated<Card> {
  const where: string[] = [];
  const params: Record<string, SQLInputValue> = {};

  if (query.search) {
    // On combine FTS (nom/effet) et LIKE sur le code, pour que "OP01-0" fonctionne.
    where.push(`(
      c.id IN (SELECT id FROM cards_fts WHERE cards_fts MATCH @ftsQuery)
      OR c.code LIKE @likeQuery
    )`);
    params.ftsQuery = `${query.search.replace(/["*]/g, ' ').trim()}*`;
    params.likeQuery = `%${query.search}%`;
  }
  if (query.setId) {
    where.push('c.set_id = @setId');
    params.setId = query.setId;
  }
  if (query.setKind) {
    where.push('s.kind = @setKind');
    params.setKind = query.setKind;
  }
  if (query.language) {
    where.push('c.language = @language');
    params.language = query.language;
  }
  if (query.baseArtOnly) {
    where.push('c.art_variant = 0');
  }
  if (query.costMin !== undefined) {
    where.push('c.cost >= @costMin');
    params.costMin = query.costMin;
  }
  if (query.costMax !== undefined) {
    where.push('c.cost <= @costMax');
    params.costMax = query.costMax;
  }
  if (query.powerMin !== undefined) {
    where.push('c.power >= @powerMin');
    params.powerMin = query.powerMin;
  }
  if (query.powerMax !== undefined) {
    where.push('c.power <= @powerMax');
    params.powerMax = query.powerMax;
  }
  if (query.categories?.length) {
    where.push(`c.category IN (${query.categories.map((_, i) => `@cat${i}`).join(',')})`);
    query.categories.forEach((value, i) => {
      params[`cat${i}`] = value;
    });
  }
  if (query.rarities?.length) {
    where.push(`c.rarity IN (${query.rarities.map((_, i) => `@rar${i}`).join(',')})`);
    query.rarities.forEach((value, i) => {
      params[`rar${i}`] = value;
    });
  }
  if (query.colors?.length) {
    // colors est un tableau JSON : une carte multicolore doit matcher chacune de ses couleurs.
    where.push(`(${query.colors.map((_, i) => `c.colors LIKE @col${i}`).join(' OR ')})`);
    query.colors.forEach((value, i) => {
      params[`col${i}`] = `%"${value}"%`;
    });
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = query.order === 'desc' ? 'DESC' : 'ASC';
  const sortColumn = {
    code: 'c.code',
    name: 'c.name',
    cost: 'c.cost',
    power: 'c.power',
    price: `(SELECT market FROM price_snapshots p
             WHERE p.card_id = c.id ORDER BY p.captured_on DESC LIMIT 1)`,
  }[query.sort ?? 'code'];

  const limit = Math.min(query.limit ?? 60, 200);
  const offset = query.offset ?? 0;

  const total =
    selectOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM cards c JOIN sets s ON s.id = c.set_id ${whereSql}`,
      params,
    )?.n ?? 0;

  const rows = selectAll<CardRow>(
    `${CARD_SELECT} ${whereSql}
     ORDER BY ${sortColumn} ${order} NULLS LAST, c.code ASC
     LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset },
  );

  return { items: rows.map(toCard), total, limit, offset };
}

/** Facettes disponibles, pour construire les filtres de l'app sans les coder en dur. */
export function cardFacets(): { rarities: string[]; types: string[]; attributes: string[] } {
  const rarities = selectAll<{ v: string }>(
    'SELECT DISTINCT rarity AS v FROM cards WHERE rarity IS NOT NULL ORDER BY rarity',
  ).map((r) => r.v);

  const collect = (column: 'types' | 'attributes'): string[] => {
    const rows = selectAll<{ v: string }>(`SELECT ${column} AS v FROM cards`);
    const set = new Set<string>();
    for (const row of rows) {
      for (const value of JSON.parse(row.v) as string[]) set.add(value);
    }
    return [...set].sort();
  };

  return { rarities, types: collect('types'), attributes: collect('attributes') };
}

// ---------------------------------------------------------------------------
// Liens marketplace
// ---------------------------------------------------------------------------

export interface MarketLink {
  cardId: string;
  marketplace: Marketplace;
  externalId: string | null;
  externalName: string | null;
  query: string | null;
  url: string | null;
  confidence: number;
}

export function getMarketLink(cardId: string, marketplace: Marketplace): MarketLink | null {
  const row = selectOne<{
    card_id: string;
    marketplace: string;
    external_id: string | null;
    external_name: string | null;
    query: string | null;
    url: string | null;
    confidence: number;
  }>('SELECT * FROM market_links WHERE card_id = ? AND marketplace = ?', [cardId, marketplace]);

  if (!row) return null;
  return {
    cardId: row.card_id,
    marketplace: row.marketplace as Marketplace,
    externalId: row.external_id,
    externalName: row.external_name,
    query: row.query,
    url: row.url,
    confidence: row.confidence,
  };
}

export function saveMarketLink(link: MarketLink): void {
  run(
    `INSERT INTO market_links (card_id, marketplace, external_id, external_name, query, url, confidence, matched_at)
       VALUES (@cardId, @marketplace, @externalId, @externalName, @query, @url, @confidence, @matchedAt)
       ON CONFLICT(card_id, marketplace) DO UPDATE SET
         external_id = excluded.external_id, external_name = excluded.external_name,
         query = excluded.query, url = excluded.url, confidence = excluded.confidence,
         matched_at = excluded.matched_at`,
    {
      cardId: link.cardId,
      marketplace: link.marketplace,
      externalId: link.externalId ?? null,
      externalName: link.externalName ?? null,
      query: link.query ?? null,
      url: link.url ?? null,
      confidence: link.confidence,
      matchedAt: nowIso(),
    },
  );
}

// ---------------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------------

export interface SnapshotInput extends PriceQuote {
  capturedOn: string;
  estimated?: boolean;
}

export function insertSnapshot(input: SnapshotInput): void {
  run(
    `INSERT INTO price_snapshots (
         card_id, marketplace, captured_on, captured_at, currency,
         low, market, avg1, avg7, avg30, listing_count, foil, url, estimated
       ) VALUES (
         @cardId, @marketplace, @capturedOn, @capturedAt, @currency,
         @low, @market, @avg1, @avg7, @avg30, @listingCount, @foil, @url, @estimated
       )
       ON CONFLICT(card_id, marketplace, foil, captured_on) DO UPDATE SET
         captured_at = excluded.captured_at, currency = excluded.currency,
         low = excluded.low, market = excluded.market, avg1 = excluded.avg1,
         avg7 = excluded.avg7, avg30 = excluded.avg30,
         listing_count = excluded.listing_count, url = excluded.url,
         -- un relevé réel écrase toujours une estimation, jamais l'inverse
         estimated = MIN(price_snapshots.estimated, excluded.estimated)`,
    {
      cardId: input.cardId,
      marketplace: input.marketplace,
      capturedOn: input.capturedOn,
      capturedAt: input.capturedAt,
      currency: input.currency,
      low: input.low ?? null,
      market: input.market ?? null,
      avg1: input.avg1 ?? null,
      avg7: input.avg7 ?? null,
      avg30: input.avg30 ?? null,
      listingCount: input.listingCount ?? null,
      foil: bool(input.foil),
      url: input.url ?? null,
      estimated: bool(input.estimated ?? false),
    },
  );
}

export function latestQuotes(cardId: string): PriceQuote[] {
  const rows = selectAll<Record<string, any>>(
    `SELECT * FROM price_snapshots p
     WHERE p.card_id = ?
       AND p.captured_on = (
         SELECT MAX(captured_on) FROM price_snapshots q
         WHERE q.card_id = p.card_id AND q.marketplace = p.marketplace AND q.foil = p.foil
       )
     ORDER BY p.marketplace, p.foil`,
    [cardId],
  );

  return rows.map((row) => ({
    cardId: row.card_id,
    marketplace: row.marketplace,
    currency: row.currency,
    low: row.low,
    market: row.market,
    avg1: row.avg1,
    avg7: row.avg7,
    avg30: row.avg30,
    listingCount: row.listing_count,
    foil: row.foil === 1,
    url: row.url,
    capturedAt: row.captured_at,
  }));
}

export function priceHistory(cardId: string, days: number): PriceHistory[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = selectAll<{
    marketplace: Marketplace;
    currency: string;
    captured_on: string;
    market: number | null;
    low: number | null;
    estimated: number;
  }>(
    `SELECT marketplace, currency, captured_on, market, low, estimated
     FROM price_snapshots
     WHERE card_id = ? AND captured_on >= ? AND foil = 0
     ORDER BY marketplace, captured_on ASC`,
    [cardId, since],
  );

  const byMarket = new Map<Marketplace, PriceHistory>();
  for (const row of rows) {
    const value = row.market ?? row.low;
    if (value === null) continue;

    let history = byMarket.get(row.marketplace);
    if (!history) {
      history = { cardId, marketplace: row.marketplace, currency: row.currency, points: [] };
      byMarket.set(row.marketplace, history);
    }
    const point: PricePoint = {
      date: row.captured_on,
      value,
      estimated: row.estimated === 1,
    };
    history.points.push(point);
  }
  return [...byMarket.values()];
}

/** Cartes à relever en priorité : celles de la collection d'abord, puis le reste. */
export function cardsToPrice(limit: number): string[] {
  const rows = selectAll<{ id: string }>(
    `SELECT c.id,
            EXISTS(SELECT 1 FROM collection_items i WHERE i.card_id = c.id) AS owned,
            (SELECT MAX(captured_on) FROM price_snapshots p WHERE p.card_id = c.id) AS last_seen
     FROM cards c
     ORDER BY owned DESC, COALESCE(last_seen, '0000') ASC, c.code ASC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

export function listCollection(): CollectionItem[] {
  const rows = selectAll<Record<string, any>>(
    'SELECT * FROM collection_items ORDER BY updated_at DESC',
  );

  return rows.map((row) => ({
    cardId: row.card_id,
    quantity: row.quantity,
    condition: row.condition,
    language: row.language,
    foil: row.foil === 1,
    acquiredPrice: row.acquired_price,
    acquiredAt: row.acquired_at,
    notes: row.notes,
    updatedAt: row.updated_at,
  }));
}

export function upsertCollectionItem(item: CollectionItem): void {
  if (item.quantity <= 0) {
    run(
      `DELETE FROM collection_items
       WHERE card_id = ? AND condition = ? AND language = ? AND foil = ?`,
      [item.cardId, item.condition, item.language, bool(item.foil)],
    );
    return;
  }

  run(
    `INSERT INTO collection_items (
         card_id, condition, language, foil, quantity, acquired_price, acquired_at, notes, updated_at
       ) VALUES (
         @cardId, @condition, @language, @foil, @quantity, @acquiredPrice, @acquiredAt, @notes, @updatedAt
       )
       ON CONFLICT(card_id, condition, language, foil) DO UPDATE SET
         quantity = excluded.quantity, acquired_price = excluded.acquired_price,
         acquired_at = excluded.acquired_at, notes = excluded.notes,
         updated_at = excluded.updated_at`,
    {
      cardId: item.cardId,
      condition: item.condition,
      language: item.language,
      foil: bool(item.foil),
      quantity: item.quantity,
      acquiredPrice: item.acquiredPrice ?? null,
      acquiredAt: item.acquiredAt ?? null,
      notes: item.notes ?? null,
      updatedAt: nowIso(),
    },
  );
}

/**
 * Remplace intégralement la collection serveur par celle de l'appareil.
 *
 * L'appareil fait autorité : une carte supprimée localement doit disparaître ici,
 * ce qu'un simple upsert ligne à ligne ne ferait pas. L'opération est transactionnelle
 * pour ne jamais laisser la sauvegarde à moitié écrite.
 */
export function replaceCollection(items: CollectionItem[]): void {
  transaction(() => {
    run('DELETE FROM collection_items');
    for (const item of items) upsertCollectionItem(item);
  });
}

export function collectionStats(marketplace: Marketplace): CollectionStats {
  const totals = selectOne<{ distinct_cards: number; total_cards: number; invested: number }>(
    `SELECT COUNT(DISTINCT i.card_id) AS distinct_cards,
            COALESCE(SUM(i.quantity), 0) AS total_cards,
            COALESCE(SUM(i.quantity * COALESCE(i.acquired_price, 0)), 0) AS invested
     FROM collection_items i`,
  ) ?? { distinct_cards: 0, total_cards: 0, invested: 0 };

  const valued = selectOne<{ value: number; currency: string | null }>(
    `SELECT COALESCE(SUM(i.quantity * COALESCE(p.market, p.low, 0)), 0) AS value,
            MAX(p.currency) AS currency
     FROM collection_items i
     LEFT JOIN price_snapshots p ON p.card_id = i.card_id
       AND p.marketplace = @marketplace
       AND p.foil = i.foil
       AND p.captured_on = (
         SELECT MAX(captured_on) FROM price_snapshots q
         WHERE q.card_id = i.card_id AND q.marketplace = @marketplace AND q.foil = i.foil
       )`,
    { marketplace },
  ) ?? { value: 0, currency: null };

  const bySet = selectAll<{
    set_id: string;
    set_name: string;
    set_kind: string;
    total: number;
    owned: number;
  }>(
    `SELECT s.id AS set_id, s.name AS set_name, s.kind AS set_kind,
            COUNT(DISTINCT c.id) AS total,
            COUNT(DISTINCT i.card_id) AS owned
     FROM sets s
     JOIN cards c ON c.set_id = s.id
     LEFT JOIN collection_items i ON i.card_id = c.id
     GROUP BY s.id
     HAVING owned > 0
     ORDER BY owned DESC`,
  );

  return {
    distinctCards: totals.distinct_cards,
    totalCards: totals.total_cards,
    estimatedValue: Math.round(valued.value * 100) / 100,
    currency: valued.currency ?? (marketplace === 'cardmarket' ? 'EUR' : 'USD'),
    investedValue: Math.round(totals.invested * 100) / 100,
    bySet: bySet.map((row) => ({
      setId: row.set_id,
      setName: row.set_name,
      setKind: row.set_kind as SetKind,
      owned: row.owned,
      total: row.total,
    })),
  };
}

// ---------------------------------------------------------------------------
// Journal de synchronisation
// ---------------------------------------------------------------------------

export function startSyncRun(kind: string, source: string | null): number {
  const result = run(
    `INSERT INTO sync_runs (kind, source, started_at, status) VALUES (?, ?, ?, 'running')`,
    [kind, source, nowIso()],
  );
  return result.lastInsertRowid;
}

export function finishSyncRun(
  id: number,
  status: 'success' | 'error',
  processed: number,
  failed: number,
  message?: string,
): void {
  run(
    `UPDATE sync_runs SET finished_at = ?, status = ?, processed = ?, failed = ?, message = ?
     WHERE id = ?`,
    [nowIso(), status, processed, failed, message ?? null, id],
  );
}

export function recentSyncRuns(limit = 20): unknown[] {
  return selectAll<Record<string, unknown>>(
    'SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?',
    [limit],
  );
}
