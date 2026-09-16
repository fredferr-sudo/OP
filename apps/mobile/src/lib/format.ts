import type { PricePoint } from '@op/shared';

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

export function formatPrice(value: number | null | undefined, currency = 'EUR'): string {
  if (value === null || value === undefined) return '—';
  const symbol = SYMBOLS[currency] ?? currency;
  const formatted = value >= 100 ? value.toFixed(0) : value.toFixed(2);
  return currency === 'USD' ? `${symbol}${formatted}` : `${formatted} ${symbol}`;
}

/** Variation en pourcentage entre le premier et le dernier point d'une série. */
export function trend(points: PricePoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  if (first <= 0) return null;
  return ((last - first) / first) * 100;
}

export function formatTrend(value: number | null): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} %`;
}

export function formatDateShort(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}
