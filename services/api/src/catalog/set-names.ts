import { config } from '../config.ts';
import { requestJson } from '../lib/http.ts';
import { normalizeSetId } from './classify.ts';

/**
 * Dictionnaire des noms de produits en anglais.
 *
 * La source principale du catalogue nomme les produits dans la langue de la
 * carte : une carte japonaise donne un nom japonais, et une carte rééditée dans
 * une collection donne le nom de la collection plutôt que celui de son extension
 * d'origine. optcgapi n'a pas de liste de cartes utilisable, mais ses deux
 * endpoints de produits fonctionnent et donnent des noms anglais canoniques —
 * c'est exactement ce qui manque ici.
 */

interface OptcgSet {
  set_name?: string;
  set_id?: string;
}

interface OptcgDeck {
  structure_deck_name?: string;
  structure_deck_id?: string;
}

export type SetNameDirectory = Map<string, string>;

export async function fetchSetNames(): Promise<SetNameDirectory> {
  const directory: SetNameDirectory = new Map();

  const add = (id: string | undefined, name: string | undefined): void => {
    if (!id || !name) return;
    directory.set(normalizeSetId(id), name.trim());
  };

  // Chacune des deux listes est facultative : leur absence dégrade les noms,
  // elle ne doit pas faire échouer la synchronisation du catalogue.
  await Promise.all([
    requestJson<OptcgSet[]>(`${config.catalog.optcgBaseUrl}/allSets/`, { retries: 0 })
      .then((sets) => {
        for (const set of sets) add(set.set_id, set.set_name);
      })
      .catch(() => undefined),

    requestJson<OptcgDeck[]>(`${config.catalog.optcgBaseUrl}/allDecks/`, { retries: 0 })
      .then((decks) => {
        for (const deck of decks) add(deck.structure_deck_id, deck.structure_deck_name);
      })
      .catch(() => undefined),
  ]);

  return directory;
}
