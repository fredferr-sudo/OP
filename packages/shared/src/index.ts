/**
 * Types partagés entre le backend (services/api) et l'application mobile (apps/mobile).
 * Toute la nomenclature métier du One Piece Card Game vit ici.
 */

/** Nature d'un produit : c'est ce qui sert de classement principal dans l'app. */
export type SetKind =
  | 'booster' // Extension (OP01, OP02, ...)
  | 'starter' // Deck de structure (ST01, ST02, ...)
  | 'promo' // Cartes promotionnelles (P-001, ...)
  | 'tournament' // Prix de tournoi / participation
  | 'special' // Produits spéciaux (EB, PRB, sets premium)
  | 'other';

export type CardCategory = 'LEADER' | 'CHARACTER' | 'EVENT' | 'STAGE' | 'DON';

export type CardColor =
  | 'Red'
  | 'Green'
  | 'Blue'
  | 'Purple'
  | 'Black'
  | 'Yellow';

/** Langue de l'impression. Le jeu est distribué en JP / EN, et partiellement en autres langues. */
export type CardLanguage = 'EN' | 'JP' | 'FR' | 'IT' | 'ES' | 'DE' | 'KR' | 'CN';

export interface CardSet {
  id: string; // "OP01"
  name: string; // "Romance Dawn"
  kind: SetKind;
  code: string | null; // code officiel affiché sur la carte
  releaseDate: string | null; // ISO YYYY-MM-DD
  cardCount: number;
  imageUrl: string | null;
}

export interface Card {
  /** Identifiant stable, unique par illustration : "OP01-001" ou "OP01-001_p1" pour un alt-art. */
  id: string;
  /** Code imprimé sur la carte, partagé par toutes les illustrations : "OP01-001". */
  code: string;
  name: string;
  setId: string;
  setName: string;
  setKind: SetKind;
  category: CardCategory;
  rarity: string | null; // C, UC, R, SR, SEC, L, P, DON!!
  colors: CardColor[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  life: number | null; // uniquement pour les LEADER
  attributes: string[]; // Slash, Strike, Ranged, Special, Wisdom
  types: string[]; // Straw Hat Crew, Supernovas, ...
  effect: string | null;
  trigger: string | null;
  imageUrl: string | null;
  /** Numéro d'illustration alternative : 0 = illustration de base. */
  artVariant: number;
  language: CardLanguage;
  updatedAt: string;
}

export type Marketplace = 'cardmarket' | 'tcgplayer' | 'ebay';

export const MARKETPLACES: Marketplace[] = ['cardmarket', 'tcgplayer', 'ebay'];

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  cardmarket: 'Cardmarket',
  tcgplayer: 'TCGplayer',
  ebay: 'eBay',
};

/** Prix constaté à un instant T sur une marketplace, pour une carte donnée. */
export interface PriceQuote {
  cardId: string;
  marketplace: Marketplace;
  currency: string; // EUR pour Cardmarket, USD pour TCGplayer/eBay
  /** Prix le plus bas actuellement proposé. */
  low: number | null;
  /** Prix de référence : "trend" chez Cardmarket, "market" chez TCGplayer, médiane des annonces sur eBay. */
  market: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  /** Nombre d'offres prises en compte (utile pour juger de la fiabilité). */
  listingCount: number | null;
  foil: boolean;
  url: string | null;
  capturedAt: string; // ISO datetime
}

/** Un point de l'historique de prix (une valeur par jour et par marketplace). */
export interface PricePoint {
  date: string; // YYYY-MM-DD
  value: number;
  /** true = point reconstruit depuis les moyennes glissantes, pas un relevé réel. */
  estimated: boolean;
}

export interface PriceHistory {
  cardId: string;
  marketplace: Marketplace;
  currency: string;
  points: PricePoint[];
}

/** Réponse agrégée servie au détail d'une carte : tout ce qu'il faut pour l'écran en un appel. */
export interface CardPricing {
  cardId: string;
  quotes: PriceQuote[];
  history: PriceHistory[];
}

export type CardCondition = 'M' | 'NM' | 'EX' | 'GD' | 'LP' | 'PL' | 'PO';

export const CONDITION_LABELS: Record<CardCondition, string> = {
  M: 'Mint',
  NM: 'Near Mint',
  EX: 'Excellent',
  GD: 'Good',
  LP: 'Light Played',
  PL: 'Played',
  PO: 'Poor',
};

/** Une ligne de la collection de l'utilisateur. Stockée localement, synchronisable. */
export interface CollectionItem {
  cardId: string;
  quantity: number;
  condition: CardCondition;
  language: CardLanguage;
  foil: boolean;
  /** Prix d'achat réel, pour calculer la plus/moins-value. */
  acquiredPrice: number | null;
  acquiredAt: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface CollectionStats {
  distinctCards: number;
  totalCards: number;
  /** Valeur estimée, dans la devise demandée. */
  estimatedValue: number;
  currency: string;
  investedValue: number;
  /** Complétion par extension. */
  bySet: Array<{
    setId: string;
    setName: string;
    setKind: SetKind;
    owned: number;
    total: number;
  }>;
}

export interface CardQuery {
  search?: string;
  setId?: string;
  setKind?: SetKind;
  colors?: CardColor[];
  categories?: CardCategory[];
  rarities?: string[];
  costMin?: number;
  costMax?: number;
  powerMin?: number;
  powerMax?: number;
  language?: CardLanguage;
  /** Regroupe les illustrations alternatives sous la carte de base. */
  baseArtOnly?: boolean;
  sort?: 'code' | 'name' | 'cost' | 'power' | 'price';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export const SET_KIND_LABELS: Record<SetKind, string> = {
  booster: 'Extensions',
  starter: 'Decks de structure',
  promo: 'Promotions',
  tournament: 'Tournois',
  special: 'Produits spéciaux',
  other: 'Autres',
};

export const COLOR_HEX: Record<CardColor, string> = {
  Red: '#d5322f',
  Green: '#1f9e63',
  Blue: '#2a72c8',
  Purple: '#7b52b5',
  Black: '#3c3f47',
  Yellow: '#e0b422',
};
