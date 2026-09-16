import type { Card } from '@op/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CARD_ASPECT_RATIO, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ColorDots } from './ui';

interface Props {
  card: Card;
  /** Nombre d'exemplaires possédés, affiché en pastille. */
  owned?: number;
  width: number;
}

/** Vignette d'une carte dans une grille. */
export function CardTile({ card, owned = 0, width }: Props) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/card/[id]', params: { id: card.id } })}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}>
        <View
          style={[
            styles.imageWrapper,
            { backgroundColor: theme.surfaceElevated, borderColor: theme.border },
          ]}>
          {card.imageUrl ? (
            <Image
              source={{ uri: card.imageUrl }}
              style={styles.image}
              contentFit="cover"
              transition={150}
              cachePolicy="disk"
            />
          ) : (
            <View style={[styles.image, styles.placeholder]}>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>{card.code}</Text>
            </View>
          )}

          {owned > 0 && (
            <View style={[styles.ownedBadge, { backgroundColor: theme.accent }]}>
              <Text style={styles.ownedText}>×{owned}</Text>
            </View>
          )}

          {card.artVariant > 0 && (
            <View style={[styles.altBadge, { backgroundColor: theme.surface }]}>
              <Text style={[styles.altText, { color: theme.textSecondary }]}>
                ALT {card.artVariant}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.meta}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
            {card.name}
          </Text>
          <View style={styles.metaRow}>
            <Text numberOfLines={1} style={[styles.code, { color: theme.textMuted }]}>
              {card.code}
              {card.rarity ? ` · ${card.rarity}` : ''}
            </Text>
            <ColorDots colors={card.colors} />
          </View>
        </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  imageWrapper: {
    width: '100%',
    aspectRatio: CARD_ASPECT_RATIO,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownedBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  ownedText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  altBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  altText: {
    fontSize: 9,
    fontWeight: '700',
  },
  meta: {
    marginTop: Spacing.xs + 2,
    gap: 2,
    // Hauteur fixe : un nom long ne doit pas décaler les vignettes voisines.
    height: 34,
  },
  name: {
    fontSize: 13,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  code: {
    fontSize: 11,
    flexShrink: 1,
  },
});
