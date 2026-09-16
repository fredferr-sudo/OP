import { SET_KIND_LABELS, type CardSet } from '@op/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, Loading } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchSets, type SetGroup } from '@/lib/api';

/**
 * Écran d'accueil : le catalogue, rangé par nature de produit.
 * C'est le classement du jeu lui-même — extensions, decks de structure,
 * promos, prix de tournoi — et non un classement alphabétique.
 */
export default function CatalogScreen() {
  const theme = useTheme();
  const [openKind, setOpenKind] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sets'],
    queryFn: fetchSets,
  });

  const groups = useMemo(() => data?.groups ?? [], [data]);

  if (isLoading) return <Loading label="Chargement du catalogue…" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        {groups.map((group) => (
          <GroupSection
            key={group.kind}
            group={group}
            expanded={openKind === group.kind || groups.length === 1}
            onToggle={() => setOpenKind(openKind === group.kind ? null : group.kind)}
          />
        ))}

        {groups.length === 0 && (
          <Text style={{ color: theme.textSecondary, padding: Spacing.lg }}>
            Le catalogue est vide. Lance la synchronisation côté backend :
            {'\n'}
            <Text style={{ fontWeight: '700' }}>npm run api:sync -- catalog</Text>
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function GroupSection({
  group,
  expanded,
  onToggle,
}: {
  group: SetGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const totalCards = group.sets.reduce((sum, set) => sum + set.cardCount, 0);

  return (
    <View style={styles.group}>
      <Pressable
        onPress={onToggle}
        style={[styles.groupHeader, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.groupTitle, { color: theme.text }]}>
            {SET_KIND_LABELS[group.kind]}
          </Text>
          <Text style={[styles.groupMeta, { color: theme.textMuted }]}>
            {plural(group.sets.length, 'produit')} · {plural(totalCards, 'carte')}
          </Text>
        </View>
        <Text style={[styles.chevron, { color: theme.textSecondary }]}>
          {expanded ? '−' : '+'}
        </Text>
      </Pressable>

      {expanded && (
        <View style={styles.setList}>
          {group.sets.map((set) => (
            <SetRow key={set.id} set={set} />
          ))}
        </View>
      )}
    </View>
  );
}

function SetRow({ set }: { set: CardSet }) {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/set/[id]', params: { id: set.id } })}
      style={({ pressed }) => [
        styles.setRow,
        { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
      ]}>
      <View style={[styles.setCode, { backgroundColor: theme.surfaceElevated }]}>
        <Text style={[styles.setCodeText, { color: theme.text }]}>{set.id}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[styles.setName, { color: theme.text }]}>
          {set.name}
        </Text>
        <Text style={[styles.setMeta, { color: theme.textMuted }]}>
          {plural(set.cardCount, 'carte')}
          {set.releaseDate ? ` · ${set.releaseDate.split('-').reverse().join('/')}` : ''}
        </Text>
      </View>
      <Text style={{ color: theme.textMuted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

/** Accord au pluriel : « 1 carte » mais « 5 cartes ». */
function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`;
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  group: {
    gap: Spacing.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  groupMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    fontWeight: '300',
    width: 24,
    textAlign: 'center',
  },
  setList: {
    gap: Spacing.xs,
    paddingLeft: Spacing.sm,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setCode: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
    minWidth: 52,
    alignItems: 'center',
  },
  setCodeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  setName: {
    fontSize: 15,
    fontWeight: '600',
  },
  setMeta: {
    fontSize: 12,
    marginTop: 1,
  },
});
