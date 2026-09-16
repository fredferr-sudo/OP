import type { Card } from '@op/shared';

/** Minuscules, sans accents ni ponctuation : base de comparaison commune. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(' ').filter(Boolean));
}

/** Indice de Jaccard entre deux chaînes, tokenisées. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/**
 * Note la correspondance entre une carte et un produit d'une marketplace.
 *
 * Le code imprimé (OP01-001) est l'élément décisif : c'est le seul identifiant
 * réellement fiable, et les marketplaces le font presque toujours figurer dans
 * le nom du produit ou dans son numéro. Le nom et l'extension affinent ensuite.
 */
export function scoreMatch(
  card: Card,
  candidate: { name: string; setName?: string | null; number?: string | null },
): number {
  const haystack = normalize(
    [candidate.name, candidate.setName ?? '', candidate.number ?? ''].join(' '),
  );
  const code = normalize(card.code);

  let score = 0;

  if (haystack.includes(code)) {
    score += 0.6;
  } else if (candidate.number && normalize(candidate.number) === code) {
    score += 0.6;
  }

  score += 0.3 * similarity(card.name, candidate.name);

  if (candidate.setName && similarity(card.setName, candidate.setName) > 0.5) {
    score += 0.1;
  }

  // Une illustration alternative ne doit pas être confondue avec la carte de base.
  const candidateIsAlt = /\b(alt|alternate|parallel|manga|special art|sp)\b/.test(haystack);
  if (candidateIsAlt !== card.artVariant > 0) {
    score -= 0.15;
  }

  return Math.max(0, Math.min(1, score));
}

/** Requête texte utilisée sur les marketplaces sans identifiant produit (eBay). */
export function searchQuery(card: Card): string {
  return `One Piece Card Game ${card.code} ${card.name}`.trim();
}
