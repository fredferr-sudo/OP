import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { CardGrid } from '@/components/card-grid';
import { Spacing } from '@/constants/theme';
import { useEdition } from '@/hooks/use-edition';
import { useTheme } from '@/hooks/use-theme';
import { fetchSets } from '@/lib/api';

/** Toutes les cartes d'un produit (extension, deck de structure, promo…). */
export default function SetScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { edition } = useEdition();

  const { data } = useQuery({ queryKey: ['sets', edition], queryFn: () => fetchSets(edition) });
  const set = data?.sets.find((s) => s.id === id);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: set?.name ?? id }} />
      <CardGrid
        // Le produit est le même d'une édition à l'autre, ses cartes non : sans
        // ce filtre, OP01 mêlerait ses impressions globales, françaises et
        // japonaises dans une seule grille où chaque carte apparaîtrait trois fois.
        query={{ setId: id, language: edition, sort: 'code', order: 'asc' }}
        header={
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>{set?.name ?? id}</Text>
            <Text style={[styles.meta, { color: theme.textMuted }]}>
              {set ? `${set.id} · ${set.cardCount} carte${set.cardCount > 1 ? 's' : ''}` : ''}
            </Text>
          </View>
        }
        emptyTitle="Produit vide"
        emptyDescription="Aucune carte n'est rattachée à ce produit dans la base."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: Spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  meta: {
    fontSize: 13,
    marginTop: 2,
  },
});
