import '@/global.css';

import { Platform } from 'react-native';

/**
 * Palette de l'app. Le thème sombre est le thème de référence : une collection
 * de cartes se regarde surtout en images, et un fond sombre laisse les visuels
 * ressortir.
 */
export const Colors = {
  light: {
    text: '#11131a',
    textSecondary: '#5b6070',
    textMuted: '#8a90a2',
    background: '#f6f7fb',
    surface: '#ffffff',
    surfaceElevated: '#eef0f6',
    border: '#dfe2ec',
    accent: '#c8102e',
    accentSoft: '#fbe7ea',
    positive: '#1f9e63',
    negative: '#d5322f',
  },
  dark: {
    text: '#f2f4fa',
    textSecondary: '#a4abbd',
    textMuted: '#767d90',
    background: '#0b1020',
    surface: '#141a2e',
    surfaceElevated: '#1d2440',
    border: '#252c48',
    accent: '#e8384f',
    accentSoft: '#2a1420',
    positive: '#3ecf8e',
    negative: '#ff6b6b',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type Theme = Record<ThemeColor, string>;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 18,
} as const;

/** Ratio officiel des cartes One Piece (63 x 88 mm). */
export const CARD_ASPECT_RATIO = 63 / 88;

/**
 * Largeur maximale du contenu. L'app est pensée pour un téléphone ; ouverte dans
 * un navigateur de bureau, sans cette limite, les lignes s'étireraient sur toute
 * la fenêtre et deviendraient illisibles.
 */
export const MAX_CONTENT_WIDTH = 760;

/** Largeur visée pour une vignette de carte : elle détermine le nombre de colonnes. */
export const TILE_TARGET_WIDTH = 116;
