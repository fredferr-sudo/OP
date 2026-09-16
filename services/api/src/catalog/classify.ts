import type { CardCategory, CardColor, SetKind } from '@op/shared';

/**
 * Déduit la nature d'un produit à partir de son identifiant et de son nom.
 * Bandai ne publie pas cette information : c'est la convention de nommage qui
 * la porte (OP01 = extension, ST01 = deck de structure, P-001 = promo...).
 */
export function inferSetKind(setId: string, setName: string): SetKind {
  const id = setId.toUpperCase();
  const name = setName.toLowerCase();

  if (/championship|tournament|winner|regional|store battle|treasure cup|finals/.test(name)) {
    return 'tournament';
  }
  if (/^ST\d+/.test(id) || /starter deck|structure deck/.test(name)) return 'starter';
  if (/^OP\d+/.test(id)) return 'booster';
  if (/^(EB|PRB)\d+/.test(id) || /extra booster|premium booster|premium card/.test(name)) {
    return 'special';
  }
  if (/^P-/.test(id) || /promo|promotion|gift|anniversary set|pack/.test(name)) return 'promo';
  return 'other';
}

const CATEGORY_MAP: Record<string, CardCategory> = {
  leader: 'LEADER',
  character: 'CHARACTER',
  event: 'EVENT',
  stage: 'STAGE',
  don: 'DON',
  'don!!': 'DON',
};

export function normalizeCategory(raw: string | null | undefined): CardCategory {
  if (!raw) return 'CHARACTER';
  return CATEGORY_MAP[raw.trim().toLowerCase()] ?? 'CHARACTER';
}

const VALID_COLORS: CardColor[] = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];

/** "Red/Green" ou "Red Green" -> ["Red", "Green"] */
export function normalizeColors(raw: string | string[] | null | undefined): CardColor[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(/[\/,|]/);
  const result: CardColor[] = [];
  for (const part of parts) {
    const clean = part.trim().toLowerCase();
    const match = VALID_COLORS.find((c) => c.toLowerCase() === clean);
    if (match && !result.includes(match)) result.push(match);
  }
  return result;
}

export function splitList(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(/[\/,;]/);
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
}

export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '' || raw === '-') return null;
  const value = Number(String(raw).replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Extrait le numéro d'illustration alternative.
 * apitcg suffixe les alt-arts ("OP01-001_p1"), optcgapi utilise "OP01-001_p1" aussi.
 */
export function parseArtVariant(id: string): number {
  const match = /_p(\d+)$/i.exec(id);
  return match ? Number(match[1]) : 0;
}

export function baseCode(id: string): string {
  return id.replace(/_p\d+$/i, '').toUpperCase();
}

/** "OP01-001" -> "OP01" */
export function setIdFromCode(code: string): string {
  const match = /^([A-Z0-9]+)-/i.exec(code);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}
