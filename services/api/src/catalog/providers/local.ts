import type { CardSet } from '@op/shared';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferSetKind } from '../classify.ts';
import type { CatalogCard, CatalogPayload, CatalogProvider } from '../types.ts';

const here = dirname(fileURLToPath(import.meta.url));

interface SeedFile {
  sets: Array<{ id: string; name: string; kind?: string; releaseDate: string | null }>;
  cards: Array<Omit<CatalogCard, 'setName' | 'imageUrl' | 'language'> & { imageUrl?: string }>;
}

/** URL du visuel officiel Bandai pour un identifiant de carte donné. */
function officialImageUrl(cardId: string): string {
  return `https://en.onepiece-cardgame.com/images/cardlist/card/${cardId}.png`;
}

/**
 * Catalogue local de démarrage : permet de faire tourner toute la chaîne
 * (API, app, prix) sans aucune clé ni accès réseau.
 */
export class LocalProvider implements CatalogProvider {
  readonly name = 'local';

  async fetchAll(): Promise<CatalogPayload> {
    const seed = JSON.parse(readFileSync(join(here, '..', 'seed.json'), 'utf8')) as SeedFile;

    const setsById = new Map(seed.sets.map((s) => [s.id, s]));

    const sets = seed.sets.map((s) => ({
      id: s.id,
      name: s.name,
      kind: (s.kind as CardSet['kind']) ?? inferSetKind(s.id, s.name),
      code: s.id,
      releaseDate: s.releaseDate,
      imageUrl: null,
    }));

    const cards: CatalogCard[] = seed.cards.map((c) => ({
      ...c,
      setName: setsById.get(c.setId)?.name ?? c.setId,
      imageUrl: c.imageUrl ?? officialImageUrl(c.id),
      language: 'EN',
    }));

    return { sets, cards };
  }
}
