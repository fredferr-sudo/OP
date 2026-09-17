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

  // Composite sans tiret (« EB0304 » pour une carte présente dans EB03 et EB04).
  // Les numéros de produit du jeu tiennent sur deux chiffres, donc quatre chiffres
  // d'affilée désignent deux produits accolés : on retient le premier.
  const glued = /^([A-Z]+)(\d{2})\d{2}$/.exec(id);
  if (glued) return `${glued[1]}${glued[2]}`;

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
export interface CardSetEntry {
  /** Absent pour les produits nommés sans code : promos, packs de tournoi. */
  code: string | null;
  name: string;
}

export function parseCardSets(raw: string | null | undefined): CardSetEntry[] {
  if (!raw) return [];

  const entries: CardSetEntry[] = [];
  const pattern = /([^\[\]]*)\[([^\]]+)\]/g;
  const trim = (value: string) => value.replace(/^[\s\-,;/|]+|[\s\-,;/|]+$/g, '').trim();

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const code = match[2].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (code) entries.push({ code, name: trim(match[1]) });
  }

  // Une bonne partie du catalogue — packs de tournoi, participations, promos —
  // nomme son produit sans lui donner de code. Les ignorer revenait à reverser
  // ces cartes dans l'extension de leur numéro, ce qui les rangeait au mauvais
  // endroit et privait l'app de produits que le jeu distingue réellement.
  if (entries.length === 0) {
    const name = trim(raw);
    if (name) entries.push({ code: null, name });
  }

  return entries;
}

/** Clé de regroupement : le code quand il existe, sinon le nom du produit. */
export function productKey(entry: CardSetEntry): string {
  return entry.code ?? entry.name.toUpperCase();
}

/** Un code de produit réel : des lettres suivies d'un numéro (OP05, EB04, PRB01). */
function isNumberedProduct(code: string): boolean {
  return /^[A-Z]+\d+$/.test(code);
}

/**
 * Produit auquel rattacher une carte.
 *
 * Trois sources se contredisent parfois, et cet ordre a été établi en comparant
 * le résultat aux effectifs réels du jeu :
 *
 *  1. Le code du produit, quand la source en donne un — il l'emporte, car c'est
 *     lui qui envoie une illustration alternative vers la collection premium
 *     dont elle provient plutôt que vers l'extension de son numéro.
 *  2. Un code combiné (« OP14EB04 ») désigne deux produits sortis ensemble :
 *     le numéro de la carte tranche auquel des deux elle appartient.
 *  3. Sans code, le champ `set` fait foi quand il porte un code numéroté, sinon
 *     c'est le nom du produit — « P » regroupe toutes les promotions, et seul
 *     le nom distingue un pack de tournoi d'un autre.
 */
export function resolveProductId(
  cardId: string,
  setField: string | null | undefined,
  entry?: CardSetEntry,
): string {
  const fromCardId = (cardId.split('-')[0] ?? '').toUpperCase();
  const setId = normalizeSetId(String(setField ?? ''));

  if (entry?.code) {
    const code = entry.code.toUpperCase();
    const composite = /^([A-Z]+\d+)([A-Z]+\d+)$/.exec(code);
    if (composite) {
      return composite[1] === fromCardId || composite[2] === fromCardId
        ? fromCardId
        : composite[1];
    }
    return normalizeSetId(code);
  }

  if (isNumberedProduct(setId)) return setId;
  return entry ? entry.name.toUpperCase() : setId;
}

/** Une chaîne contenant des kana ou des kanji : on préfère un nom latin quand il existe. */
export function isJapanese(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(value);
}
