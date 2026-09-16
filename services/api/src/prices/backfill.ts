import type { PriceQuote } from '@op/shared';

export interface EstimatedPoint {
  date: string;
  value: number;
}

/**
 * Reconstruit une courbe de prix approximative sur les 30 derniers jours à partir
 * des moyennes glissantes fournies par Cardmarket (AVG1, AVG7, AVG30).
 *
 * Le raisonnement : ces trois moyennes contraignent trois segments successifs.
 * En notant A la valeur d'aujourd'hui, B celle des 6 jours précédents et C celle
 * des 23 jours d'avant :
 *
 *     avg7  = (A + 6B) / 7        ->  B = (7·avg7 - A) / 6
 *     avg30 = (A + 6B + 23C) / 30 ->  C = (30·avg30 - 7·avg7) / 23
 *
 * On place ensuite ces trois valeurs au milieu de leur segment et on interpole
 * linéairement, ce qui donne une courbe plausible plutôt qu'un escalier.
 *
 * Les points produits sont marqués `estimated` : ils servent uniquement à ne pas
 * afficher un graphique vide le premier jour, et chaque relevé réel les remplace.
 */
export function backfillFromAverages(quote: PriceQuote, days = 30): EstimatedPoint[] {
  const today = quote.market ?? quote.avg1 ?? quote.low;
  if (today === null) return [];

  const avg7 = quote.avg7;
  const avg30 = quote.avg30;

  // Sans moyennes glissantes (TCGplayer, eBay), on ne fabrique pas d'historique :
  // une ligne plate inventée serait trompeuse.
  if (avg7 === null || avg30 === null) return [];

  const a = quote.avg1 ?? today;
  const b = (7 * avg7 - a) / 6;
  const c = (30 * avg30 - 7 * avg7) / 23;

  // Anchors : (jours avant aujourd'hui, valeur), du plus ancien au plus récent.
  const anchors: Array<[number, number]> = [
    [-18, c], // milieu du segment J-29 .. J-7
    [-3.5, b], // milieu du segment J-6 .. J-1
    [0, a],
  ];

  const raw: number[] = [];
  for (let offset = -(days - 1); offset <= 0; offset += 1) {
    raw.push(interpolate(anchors, offset));
  }

  // L'interpolation lisse les paliers, ce qui décale légèrement les moyennes.
  // On recale chaque segment sur sa cible pour que la courbe redonne
  // exactement AVG1 / AVG7 / AVG30 quand on la remoyenne.
  const oldest = Math.max(0, days - 7);
  rescale(raw, 0, oldest, c);
  rescale(raw, oldest, days - 1, b);
  raw[days - 1] = a;

  const startOfDay = new Date();
  startOfDay.setHours(12, 0, 0, 0);

  const points: EstimatedPoint[] = [];
  raw.forEach((value, index) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const offset = index - (days - 1);
    const date = new Date(startOfDay.getTime() + offset * 86_400_000);
    points.push({
      date: date.toISOString().slice(0, 10),
      value: Math.round(value * 100) / 100,
    });
  });

  return points;
}

/** Recale [from, to[ pour que sa moyenne vaille exactement `target`. */
function rescale(values: number[], from: number, to: number, target: number): void {
  const length = to - from;
  if (length <= 0) return;

  let sum = 0;
  for (let i = from; i < to; i += 1) sum += values[i];
  const mean = sum / length;
  if (mean <= 0) {
    for (let i = from; i < to; i += 1) values[i] = target;
    return;
  }

  const factor = target / mean;
  for (let i = from; i < to; i += 1) values[i] *= factor;
}

function interpolate(anchors: Array<[number, number]>, x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  if (x >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) {
      const ratio = (x - x0) / (x1 - x0);
      return y0 + ratio * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}
