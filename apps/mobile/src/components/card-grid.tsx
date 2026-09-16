import type { Card, CardQuery } from '@op/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { fetchCards } from '@/lib/api';
import { ownedCounts } from '@/lib/storage';
import { CardTile } from './card-tile';
import { EmptyState, ErrorState, Loading } from './ui';

const PAGE_SIZE = 60;
const COLUMNS = 3;

interface Props {
  query: CardQuery;
  header?: React.ReactElement;
  emptyTitle?: string;
  emptyDescription?: string;
}

/**
 * Grille paginée de cartes. Utilisée telle quelle par l'écran d'une extension
 * et par la recherche : seule la requête change.
 */
export function CardGrid({ query, header, emptyTitle, emptyDescription }: Props) {
  const { width } = useWindowDimensions();
  const [owned, setOwned] = useState<Record<string, number>>({});

  // Les quantités possédées viennent de la base locale, pas du backend :
  // elles doivent s'afficher même hors ligne. On les relit à chaque fois que
  // l'écran reprend le focus, sinon un ajout fait depuis une fiche carte
  // n'apparaîtrait pas au retour sur la grille.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void ownedCounts().then((counts) => {
        if (active) setOwned(counts);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['cards', query],
      initialPageParam: 0,
      queryFn: ({ pageParam }) =>
        fetchCards({ ...query, limit: PAGE_SIZE, offset: pageParam as number }),
      getNextPageParam: (lastPage) => {
        const next = lastPage.offset + lastPage.limit;
        return next < lastPage.total ? next : undefined;
      },
    });

  const cards: Card[] = data?.pages.flatMap((page) => page.items) ?? [];

  const gutter = Spacing.lg;
  const tileWidth = (width - gutter * 2 - Spacing.sm * (COLUMNS - 1)) / COLUMNS;

  const renderItem = useCallback(
    ({ item }: { item: Card }) => (
      <CardTile card={item} owned={owned[item.id] ?? 0} width={tileWidth} />
    ),
    [owned, tileWidth],
  );

  if (isLoading) return <Loading label="Chargement des cartes…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <FlatList
      data={cards}
      keyExtractor={(item) => item.id}
      numColumns={COLUMNS}
      renderItem={renderItem}
      ListHeaderComponent={header}
      columnWrapperStyle={styles.row}
      contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      }}
      onEndReachedThreshold={0.6}
      ListFooterComponent={isFetchingNextPage ? <Loading /> : <View style={{ height: 24 }} />}
      ListEmptyComponent={
        <EmptyState
          title={emptyTitle ?? 'Aucune carte'}
          description={emptyDescription ?? 'Aucun résultat pour ces critères.'}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: Spacing.md,
    gap: Spacing.lg,
  },
  row: {
    gap: Spacing.sm,
  },
});
