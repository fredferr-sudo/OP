import { MARKETPLACE_LABELS, type PriceHistory } from '@op/shared';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateShort, formatPrice } from '@/lib/format';

const SERIES_COLORS: Record<string, string> = {
  cardmarket: '#3ecf8e',
  tcgplayer: '#5b9cf6',
  ebay: '#f2b01e',
};

const HEIGHT = 180;
const PADDING = { top: 12, right: 14, bottom: 22, left: 52 };

interface Props {
  history: PriceHistory[];
  width: number;
}

/**
 * Courbe d'évolution des prix, une série par marketplace.
 *
 * Les séries ne partagent pas la même devise (EUR chez Cardmarket, USD ailleurs).
 * Les superposer sur une échelle commune donnerait une lecture fausse, donc on
 * n'affiche qu'une marketplace à la fois et on bascule via les onglets.
 */
export function PriceChart({ history, width }: Props) {
  const theme = useTheme();
  const available = history.filter((h) => h.points.length > 0);
  const [selected, setSelected] = useState(0);

  const series = available[Math.min(selected, available.length - 1)];

  const geometry = useMemo(() => {
    if (!series || series.points.length === 0) return null;

    const values = series.points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Marge de 8 % pour que la courbe ne colle pas aux bords.
    const span = max - min || max || 1;
    const low = Math.max(0, min - span * 0.08);
    const high = max + span * 0.08;

    const innerWidth = width - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

    const x = (index: number) =>
      PADDING.left +
      (series.points.length === 1
        ? innerWidth / 2
        : (index / (series.points.length - 1)) * innerWidth);
    const y = (value: number) =>
      PADDING.top + innerHeight - ((value - low) / (high - low)) * innerHeight;

    const line = series.points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`)
      .join(' ');

    const area = `${line} L${x(series.points.length - 1)},${PADDING.top + innerHeight} L${x(0)},${
      PADDING.top + innerHeight
    } Z`;

    // Frontière entre les points reconstruits et les relevés réels.
    const firstReal = series.points.findIndex((p) => !p.estimated);

    return { x, y, line, area, low, high, firstReal };
  }, [series, width]);

  if (!series || !geometry) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.surfaceElevated }]}>
        <Text style={{ color: theme.textSecondary }}>
          Pas encore d&apos;historique pour cette carte. Le premier relevé l&apos;alimentera.
        </Text>
      </View>
    );
  }

  const color = SERIES_COLORS[series.marketplace] ?? theme.accent;
  const estimatedCount = series.points.filter((p) => p.estimated).length;

  return (
    <View>
      {available.length > 1 && (
        <View style={styles.tabs}>
          {available.map((item, index) => {
            const active = item === series;
            return (
              <Pressable
                key={item.marketplace}
                onPress={() => setSelected(index)}
                style={[
                  styles.tab,
                  {
                    backgroundColor: active ? theme.surfaceElevated : 'transparent',
                    borderColor: active ? SERIES_COLORS[item.marketplace] : theme.border,
                  },
                ]}>
                <Text
                  style={{
                    color: active ? theme.text : theme.textSecondary,
                    fontSize: 13,
                    fontWeight: '600',
                  }}>
                  {MARKETPLACE_LABELS[item.marketplace]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Svg width={width} height={HEIGHT}>
        {/* Graduations horizontales, avec leur valeur en ordonnée */}
        {[0, 0.5, 1].map((ratio) => {
          const value = geometry.high - ratio * (geometry.high - geometry.low);
          const y = geometry.y(value);
          return (
            <Line
              key={`line-${ratio}`}
              x1={PADDING.left}
              y1={y}
              x2={width - PADDING.right}
              y2={y}
              stroke={theme.border}
              strokeWidth={1}
            />
          );
        })}
        {[0, 0.5, 1].map((ratio) => {
          const value = geometry.high - ratio * (geometry.high - geometry.low);
          return (
            <SvgText
              key={`label-${ratio}`}
              x={PADDING.left - 6}
              y={geometry.y(value) + 3}
              fill={theme.textMuted}
              fontSize={10}
              textAnchor="end">
              {formatPrice(value, series.currency)}
            </SvgText>
          );
        })}

        {/* Zone couverte par les valeurs reconstruites */}
        {geometry.firstReal > 0 && (
          <Rect
            x={PADDING.left}
            y={PADDING.top}
            width={geometry.x(geometry.firstReal) - PADDING.left}
            height={HEIGHT - PADDING.top - PADDING.bottom}
            fill={theme.textMuted}
            opacity={0.08}
          />
        )}

        <Path d={geometry.area} fill={color} opacity={0.12} />
        <Path d={geometry.line} stroke={color} strokeWidth={2} fill="none" />

        <Circle
          cx={geometry.x(series.points.length - 1)}
          cy={geometry.y(series.points[series.points.length - 1].value)}
          r={4}
          fill={color}
        />
      </Svg>

      <View style={[styles.axis, { paddingLeft: PADDING.left }]}>
        <Text style={[styles.axisLabel, { color: theme.textMuted }]}>
          {formatDateShort(series.points[0].date)}
        </Text>
        <Text style={[styles.axisLabel, { color: theme.textMuted }]}>
          {series.points.length} relevés
        </Text>
        <Text style={[styles.axisLabel, { color: theme.textMuted }]}>
          {formatDateShort(series.points[series.points.length - 1].date)}
        </Text>
      </View>

      {estimatedCount > 0 && (
        <Text style={[styles.note, { color: theme.textMuted }]}>
          La zone grisée ({estimatedCount} j) est reconstruite depuis les moyennes Cardmarket, en
          attendant les relevés quotidiens.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
  },
  axisLabel: {
    fontSize: 11,
  },
  note: {
    fontSize: 11,
    marginTop: Spacing.sm,
    lineHeight: 15,
  },
  empty: {
    height: 120,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
});
