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

/**
 * Normalise un identifiant de produit.
 *
 * La source utilise parfois un identifiant composite pour une carte présente dans
 * deux produits (« OP15-EB04 »). Le premier code est celui du produit d'origine ;
 * c'est lui qui doit classer la carte, sans quoi l'app invente des extensions.
 */
export function normalizeSetId(raw: string): string {
  const id = raw.trim().toUpperCase();

  // Composite (« OP15-EB04 ») : les deux parties portent lettres ET chiffres.
  const composite = /^([A-Z]+\d+)-([A-Z]+\d+)$/.exec(id);
  if (composite) return composite[1];

  // Sinon le tiret n'est qu'un séparateur de présentation : « OP-01 » et « OP01 »
  // désignent le même produit, et doivent donner la même clé — sans quoi le
  // dictionnaire de noms anglais ne correspond jamais.
  return id.replace(/[^A-Z0-9]/g, '');
}

/**
 * Découpe un champ « CardSets » en couples produit/code.
 *
 * Le format est « -NOM DU PRODUIT- [CODE] », répété quand la carte figure dans
 * plusieurs produits. Le séparateur entre entrées n'est pas documenté, donc on
 * s'appuie uniquement sur les crochets, qui sont fiables : chaque code est
 * précédé de son nom.
 */
export function parseCardSets(raw: string | null | undefined): Array<{ code: string; name: string }> {
  if (!raw) return [];

  const entries: Array<{ code: string; name: string }> = [];
  const pattern = /([^\[\]]*)\[([^\]]+)\]/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const name = match[1].replace(/^[\s\-,;/|]+|[\s\-,;/|]+$/g, '').trim();
    const code = match[2].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (code) entries.push({ code, name });
  }
  return entries;
}

/** Une chaîne contenant des kana ou des kanji : on préfère un nom latin quand il existe. */
export function isJapanese(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(value);
}
