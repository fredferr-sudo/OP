import type {
  CardQuery,
  CollectionItem,
  Marketplace,
  SetKind,
} from '@op/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { syncCatalog } from '../catalog/sync.ts';
import { nowIso } from '../db/index.ts';
import { isSafeCardId, loadCardImage } from '../images.ts';
import {
  cardFacets,
  collectionStats,
  getCard,
  getCardVariants,
  getCardsByIds,
  latestQuotes,
  listCollection,
  listEditions,
  listSets,
  priceHistory,
  pricingId,
  queryCards,
  recentSyncRuns,
  replaceCollection,
  upsertCollectionItem,
} from '../db/repositories.ts';
import { providerStatus, syncPrices } from '../prices/sync.ts';

/**
 * Remplace l'adresse d'origine des visuels par celle du relais local.
 * Calculée depuis la requête, elle reste correcte que l'app appelle le backend
 * par « localhost » sur un ordinateur ou par son IP locale depuis un téléphone.
 */
function withImageProxy<T extends { id: string; imageUrl: string | null }>(
  cards: T[],
  request: FastifyRequest,
): T[] {
  const base = `${request.protocol}://${request.host}`;
  return cards.map((card) => ({
    ...card,
    imageUrl: `${base}/cards/${encodeURIComponent(card.id)}/image`,
  }));
}

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

  app.get('/sets', async (request) => {
    // L'édition pilote le catalogue entier : elle décide des produits listés,
    // de leur nom et de leurs effectifs. Sans paramètre, tout est renvoyé.
    const { language } = request.query as { language?: string };
    const sets = listSets((language as CardQuery['language']) || undefined);
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

  /** Éditions réellement présentes en base, avec leurs effectifs. */
  app.get('/editions', async () => ({ editions: listEditions() }));

  /**
   * Visuel d'une carte, servi par le backend plutôt que par le site de l'éditeur :
   * celui-ci refuse souvent l'affichage depuis une autre origine.
   */
  app.get('/cards/:id/image', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isSafeCardId(id)) return reply.code(400).send({ error: 'Identifiant invalide' });

    const card = getCard(id);
    const image = await loadCardImage(id, card?.imageUrl ?? null);
    if (!image) return reply.code(404).send({ error: 'Aucun visuel pour cette carte' });

    return reply
      .header('content-type', image.contentType)
      // Un visuel de carte ne change jamais.
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(image.body);
  });

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
      since: q.since || undefined,
      baseArtOnly: q.baseArtOnly === 'true',
      sort: (q.sort as CardQuery['sort']) || undefined,
      order: (q.order as CardQuery['order']) || undefined,
      limit: parseNumber(q.limit),
      offset: parseNumber(q.offset),
    };
    const page = queryCards(query);
    // La date du serveur accompagne la réponse : c'est elle que l'appareil
    // garde en repère pour son prochain « ce qui a changé depuis ». Se fier à
    // sa propre horloge lui ferait rater ou redemander des cartes.
    return { ...page, items: withImageProxy(page.items, request), serverTime: nowIso() };
  });

  app.get('/cards/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const card = getCard(id);
    if (!card) return reply.code(404).send({ error: 'Carte inconnue' });

    const [proxied] = withImageProxy([card], request);
    return {
      card: proxied,
      variants: withImageProxy(
        getCardVariants(card.code).filter((v) => v.id !== card.id),
        request,
      ),
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

    // Une impression régionale n'a pas de cote propre : les marketplaces ne
    // tiennent qu'une fiche par carte. On sert alors celle de l'impression
    // internationale, en disant laquelle — un prix dont on ignore la provenance
    // vaut moins qu'un prix annoncé comme approché.
    const priced = pricingId(id);

    return {
      cardId: id,
      quotes: latestQuotes(priced),
      history: priceHistory(priced, parseNumber(days) ?? 30),
      /** Renseigné seulement lorsque le prix vient d'une autre impression. */
      pricedAs: priced === id ? undefined : priced,
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
      cards: withImageProxy(getCardsByIds([...new Set(items.map((i) => i.cardId))]), request),
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
