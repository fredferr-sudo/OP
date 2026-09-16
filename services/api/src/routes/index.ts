import type {
  CardQuery,
  CollectionItem,
  Marketplace,
  SetKind,
} from '@op/shared';
import type { FastifyInstance } from 'fastify';
import { syncCatalog } from '../catalog/sync.ts';
import {
  cardFacets,
  collectionStats,
  getCard,
  getCardVariants,
  getCardsByIds,
  latestQuotes,
  listCollection,
  listSets,
  priceHistory,
  queryCards,
  recentSyncRuns,
  replaceCollection,
  upsertCollectionItem,
} from '../db/repositories.ts';
import { providerStatus, syncPrices } from '../prices/sync.ts';

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', providers: providerStatus() }));

  // -------------------------------------------------------------------------
  // Catalogue
  // -------------------------------------------------------------------------

  app.get('/sets', async () => {
    const sets = listSets();
    // Renvoyé déjà regroupé : l'app affiche directement ses sections.
    const groups = new Map<SetKind, typeof sets>();
    for (const set of sets) {
      const bucket = groups.get(set.kind) ?? [];
      bucket.push(set);
      groups.set(set.kind, bucket);
    }
    return {
      sets,
      groups: [...groups.entries()].map(([kind, items]) => ({ kind, sets: items })),
    };
  });

  app.get('/facets', async () => cardFacets());

  app.get('/cards', async (request) => {
    const q = request.query as Record<string, string>;
    const query: CardQuery = {
      search: q.search || undefined,
      setId: q.setId || undefined,
      setKind: (q.setKind as SetKind) || undefined,
      colors: parseList(q.colors) as CardQuery['colors'],
      categories: parseList(q.categories) as CardQuery['categories'],
      rarities: parseList(q.rarities),
      costMin: parseNumber(q.costMin),
      costMax: parseNumber(q.costMax),
      powerMin: parseNumber(q.powerMin),
      powerMax: parseNumber(q.powerMax),
      language: (q.language as CardQuery['language']) || undefined,
      baseArtOnly: q.baseArtOnly === 'true',
      sort: (q.sort as CardQuery['sort']) || undefined,
      order: (q.order as CardQuery['order']) || undefined,
      limit: parseNumber(q.limit),
      offset: parseNumber(q.offset),
    };
    return queryCards(query);
  });

  app.get('/cards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const card = getCard(id);
    if (!card) return reply.code(404).send({ error: 'Carte inconnue' });

    return {
      card,
      variants: getCardVariants(card.code).filter((v) => v.id !== card.id),
    };
  });

  // -------------------------------------------------------------------------
  // Prix
  // -------------------------------------------------------------------------

  app.get('/cards/:id/prices', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { days } = request.query as { days?: string };

    const card = getCard(id);
    if (!card) return reply.code(404).send({ error: 'Carte inconnue' });

    return {
      cardId: id,
      quotes: latestQuotes(id),
      history: priceHistory(id, parseNumber(days) ?? 30),
    };
  });

  // -------------------------------------------------------------------------
  // Collection
  // -------------------------------------------------------------------------

  app.get('/collection', async (request) => {
    const { marketplace } = request.query as { marketplace?: Marketplace };
    const items = listCollection();
    return {
      items,
      // Les cartes possédées sont jointes ici pour éviter N appels côté app.
      cards: getCardsByIds([...new Set(items.map((i) => i.cardId))]),
      stats: collectionStats(marketplace ?? 'cardmarket'),
    };
  });

  // PUT = l'appareil envoie sa collection complète, qui remplace la sauvegarde.
  app.put('/collection', async (request) => {
    const items = request.body as CollectionItem[];
    if (!Array.isArray(items)) {
      return { ok: false, error: 'Un tableau de lignes de collection est attendu.' };
    }
    replaceCollection(items);
    return { ok: true, count: items.length };
  });

  // PATCH = mise à jour d'une seule ligne, sans toucher au reste.
  app.patch('/collection', async (request) => {
    upsertCollectionItem(request.body as CollectionItem);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Administration / synchronisation
  // -------------------------------------------------------------------------

  app.post('/sync/catalog', async () => syncCatalog());

  app.post('/sync/prices', async (request) => {
    const { limit, cardIds } = (request.body ?? {}) as { limit?: number; cardIds?: string[] };
    return syncPrices({ limit, cardIds });
  });

  app.get('/sync/runs', async () => ({ runs: recentSyncRuns() }));
}
