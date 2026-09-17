import type { CardLanguage } from '@op/shared';
import { useCallback, useEffect, useState } from 'react';

import { fetchEditions } from '@/lib/api';
import { getSetting, setSetting } from '@/lib/storage';

/**
 * Édition regardée : Global, France ou Japon.
 *
 * C'est le niveau le plus haut du catalogue, avant même la nature du produit.
 * Une même carte existe dans les trois avec son texte, son visuel et sa rareté
 * propres, et les effectifs diffèrent — OP01 compte 121 cartes en global et
 * aucune en France. Le choix est donc celui d'un joueur, pas un réglage
 * d'affichage, et il est conservé d'une session à l'autre.
 */

const SETTING_KEY = 'edition';
const DEFAULT: CardLanguage = 'EN';

/** Écoute partagée : tous les écrans doivent basculer ensemble. */
const listeners = new Set<(edition: CardLanguage) => void>();
let current: CardLanguage | null = null;

export function useEdition(): {
  edition: CardLanguage;
  setEdition: (edition: CardLanguage) => void;
  ready: boolean;
} {
  const [edition, setLocal] = useState<CardLanguage>(current ?? DEFAULT);
  const [ready, setReady] = useState(current !== null);

  useEffect(() => {
    listeners.add(setLocal);

    if (current === null) {
      void getSetting(SETTING_KEY).then((stored) => {
        current = (stored as CardLanguage | null) ?? DEFAULT;
        for (const listener of listeners) listener(current!);
        setReady(true);
      });
    }

    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  const setEdition = useCallback((next: CardLanguage) => {
    current = next;
    for (const listener of listeners) listener(next);
    void setSetting(SETTING_KEY, next);
  }, []);

  return { edition, setEdition, ready };
}

/**
 * Éditions réellement disponibles.
 *
 * Elles dépendent de ce que la synchronisation a rapporté : proposer « France »
 * alors que le backend n'a que le catalogue global n'afficherait qu'un écran
 * vide sans expliquer pourquoi.
 */
export function useAvailableEditions(): CardLanguage[] {
  const [editions, setEditions] = useState<CardLanguage[]>([DEFAULT]);

  useEffect(() => {
    let alive = true;
    void fetchEditions()
      .then((result) => {
        if (!alive) return;
        const found = result.editions.filter((e) => e.cardCount > 0).map((e) => e.language);
        if (found.length > 0) setEditions(found);
      })
      .catch(() => {
        // Backend injoignable : on reste sur l'édition globale, l'écran
        // d'erreur du catalogue dira déjà ce qui ne va pas.
      });
    return () => {
      alive = false;
    };
  }, []);

  // Ordre stable et lisible, quelle que soit celle qui compte le plus de cartes.
  const order: CardLanguage[] = ['EN', 'FR', 'JP'];
  return order.filter((language) => editions.includes(language));
}
