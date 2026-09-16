import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  value: number;
  onChange: (next: number) => void;
  label?: string;
}

/** Contrôle +/- pour ajuster le nombre d'exemplaires possédés. */
export function QuantityStepper({ value, onChange, label }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {label ? <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text> : null}
      <View style={[styles.stepper, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <Pressable
          onPress={() => onChange(Math.max(0, value - 1))}
          hitSlop={8}
          style={styles.button}>
          <Text style={[styles.symbol, { color: value > 0 ? theme.text : theme.textMuted }]}>−</Text>
        </Pressable>
        <Text style={[styles.value, { color: theme.text }]}>{value}</Text>
        <Pressable onPress={() => onChange(value + 1)} hitSlop={8} style={styles.button}>
          <Text style={[styles.symbol, { color: theme.text }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  label: {
    fontSize: 14,
    flexShrink: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Radius.sm,
  },
  button: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  symbol: {
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 24,
  },
  value: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
});
