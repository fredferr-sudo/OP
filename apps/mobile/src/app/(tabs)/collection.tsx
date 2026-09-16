import { MARKETPLACES, type Marketplace } from '@op/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card as Panel, EmptyState, Loading, SectionTitle } from '@/components/ui';
import { CARD_ASPECT_RATIO, MAX_CONTENT_WIDTH, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchServerCollection, pushCollection } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { listCollection } from '@/lib/storage';

const MARKETPLACE_TABS: Marketplace[] = MARKETPLACES;

/**
 * Ma collection.
 *
 * La collection vit sur l'appareil ; on l'envoie au backend avant de lire les
 * statistiques, parce que c'est lui qui détient les prix et sait donc la valoriser.
 */
export default function CollectionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [marketplace, setMarketplace] = useState<Marketplace>('cardmarket');
  const [localCount, setLocalCount] = useState<number | null>(null);

  const sync = useCallback(async () => {
    const local = await listCollection();
    setLocalCount(local.reduce((sum, item) => sum + item.quantity, 0));
    await pushCollection(local);
  }, []);

  const query = useQuery({
    queryKey: ['collection', marketplace],
    queryFn: async () => {
      // On pousse d'abord, on lit ensuite : les stats reflètent ainsi l'état réel.
      await sync().catch(() => undefined);
      return fetchServerCollection(marketplace);
    },
  });

  // Un ajout fait depuis une fiche carte doit se voir dès le retour sur l'onglet.
  // On ne dépend que de `refetch`, dont l'identité est stable : dépendre de
  // l'objet `query` relancerait l'effet à chaque rendu.
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const stats = query.data?.stats;
  const cardsById = new Map((query.data?.cards ?? []).map((card) => [card.id, card]));

  if (query.isLoading) return <Loading label="Calcul de la collection…" />;

  const isEmpty = (localCount ?? 0) === 0;

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />
      }>
      {isEmpty ? (
        <EmptyState
          title="Collection vide"
          description="Ouvre une carte depuis le catalogue et ajoute des exemplaires avec les boutons + / −."
        />
      ) : (
        <>
          <View style={styles.tabs}>
            {MARKETPLACE_TABS.map((item) => (
              <Pressable
                key={item}
                onPress={() => setMarketplace(item)}
                style={[
                  styles.tab,
                  {
                    backgroundColor: item === marketplace ? theme.surfaceElevated : 'transparent',
                    borderColor: item === marketplace ? theme.accent : theme.border,
                  },
                ]}>
                <Text
                  style={{
                    color: item === marketplace ? theme.text : theme.textSecondary,
                    fontSize: 13,
                    fontWeight: '600',
                  }}>
                  {item === 'cardmarket' ? 'Cardmarket' : item === 'tcgplayer' ? 'TCGplayer' : 'eBay'}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.statRow}>
            <StatCard
              label="Valeur estimée"
              value={formatPrice(stats?.estimatedValue ?? 0, stats?.currency ?? 'EUR')}
              hint={`selon ${marketplace}`}
            />
            <StatCard
              label="Investi"
              value={formatPrice(stats?.investedValue ?? 0, stats?.currency ?? 'EUR')}
              hint={
                stats && stats.investedValue > 0
                  ? `${stats.estimatedValue >= stats.investedValue ? '+' : ''}${formatPrice(
                      stats.estimatedValue - stats.investedValue,
                      stats.currency,
                    )}`
                  : 'prix d’achat non saisis'
              }
              hintColor={
                stats && stats.estimatedValue >= stats.investedValue
                  ? theme.positive
                  : theme.negative
              }
            />
          </View>

          <View style={styles.statRow}>
            <StatCard label="Cartes" value={String(stats?.totalCards ?? localCount ?? 0)} />
            <StatCard label="Références" value={String(stats?.distinctCards ?? 0)} />
          </View>

          <SectionTitle>Complétion par produit</SectionTitle>
          <Panel>
            {(stats?.bySet ?? []).map((row) => (
              <View key={row.setId} style={styles.progressRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                    {row.setName}
                  </Text>
                  <View style={[styles.progressTrack, { backgroundColor: theme.surfaceElevated }]}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          backgroundColor: theme.accent,
                          width: `${Math.min(100, (row.owned / Math.max(1, row.total)) * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Text style={{ color: theme.textMuted, fontSize: 12, width: 64, textAlign: 'right' }}>
                  {row.owned}/{row.total}
                </Text>
              </View>
            ))}
            {(stats?.bySet.length ?? 0) === 0 ? (
              <Text style={{ color: theme.textSecondary }}>
                Synchronise pour calculer la complétion.
              </Text>
            ) : null}
          </Panel>

          <SectionTitle>Mes cartes</SectionTitle>
          <View style={styles.list}>
            {(query.data?.items ?? []).map((item) => {
              const card = cardsById.get(item.cardId);
              return (
                <Pressable
                  key={`${item.cardId}-${item.condition}-${item.language}-${item.foil}`}
                  onPress={() =>
                    router.push({ pathname: '/card/[id]', params: { id: item.cardId } })
                  }
                  style={({ pressed }) => [
                    styles.itemRow,
                    { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
                  ]}>
                  {card?.imageUrl ? (
                    <Image
                      source={{ uri: card.imageUrl }}
                      style={[styles.thumb, { backgroundColor: theme.surfaceElevated }]}
                      contentFit="cover"
                      cachePolicy="disk"
                    />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: theme.surfaceElevated }]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '600' }}>
                      {card?.name ?? item.cardId}
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                      {item.cardId} · {item.condition} · {item.language}
                      {item.foil ? ' · Foil' : ''}
                    </Text>
                  </View>
                  <Text style={{ color: theme.text, fontWeight: '700' }}>×{item.quantity}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function StatCard({
  label,
  value,
  hint,
  hintColor,
}: {
  label: string;
  value: string;
  hint?: string;
  hintColor?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={{ color: theme.textMuted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700', marginTop: 2 }}>
        {value}
      </Text>
      {hint ? (
        <Text style={{ color: hintColor ?? theme.textMuted, fontSize: 12, marginTop: 2 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl * 2,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  tabs: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  tab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm - 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  statRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  statCard: {
    flex: 1,
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    marginTop: Spacing.xs + 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  list: {
    gap: Spacing.xs,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 40,
    height: 40 / CARD_ASPECT_RATIO,
    borderRadius: Radius.sm,
  },
});
