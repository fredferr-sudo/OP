import { COLOR_HEX, type CardColor } from '@op/shared';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Badge({ label, color }: { label: string; color?: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: color ? `${color}22` : theme.surfaceElevated, borderColor: color ?? theme.border },
      ]}>
      <Text style={[styles.badgeText, { color: color ?? theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

export function ColorDots({ colors }: { colors: CardColor[] }) {
  return (
    <View style={styles.dots}>
      {colors.map((color) => (
        <View key={color} style={[styles.dot, { backgroundColor: COLOR_HEX[color] }]} />
      ))}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <Text style={[styles.sectionTitleText, { color: theme.text }]}>{children}</Text>
      {action}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? theme.accent : 'transparent',
          borderColor: primary ? theme.accent : theme.border,
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
      ]}>
      <Text style={[styles.buttonText, { color: primary ? '#ffffff' : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Loading({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.accent} />
      {label ? <Text style={[styles.centeredText, { color: theme.textSecondary }]}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.centered}>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text>
      {description ? (
        <Text style={[styles.centeredText, { color: theme.textSecondary }]}>{description}</Text>
      ) : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const theme = useTheme();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <View style={styles.centered}>
      <Text style={[styles.emptyTitle, { color: theme.text }]}>Backend injoignable</Text>
      <Text style={[styles.centeredText, { color: theme.textSecondary }]}>
        {message}
        {'\n'}Vérifie l&apos;adresse du serveur dans Réglages.
      </Text>
      {onRetry ? <Button label="Réessayer" onPress={onRetry} variant="ghost" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    marginTop: Spacing.lg,
  },
  sectionTitleText: {
    fontSize: 18,
    fontWeight: '700',
  },
  card: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  button: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  centeredText: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
});
