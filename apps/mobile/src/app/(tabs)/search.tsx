import {
  COLOR_HEX,
  type CardCategory,
  type CardColor,
  type CardQuery,
} from '@op/shared';
import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CardGrid } from '@/components/card-grid';
import { MAX_CONTENT_WIDTH, Radius, Spacing } from '@/constants/theme';
import { useEdition } from '@/hooks/use-edition';
import { useTheme } from '@/hooks/use-theme';
import { fetchFacets } from '@/lib/api';

const COLORS: CardColor[] = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];
const CATEGORIES: CardCategory[] = ['LEADER', 'CHARACTER', 'EVENT', 'STAGE'];

const CATEGORY_LABELS: Record<CardCategory, string> = {
  LEADER: 'Leader',
  CHARACTER: 'Personnage',
  EVENT: 'Événement',
  STAGE: 'Terrain',
  DON: 'DON!!',
};

/** Recherche plein texte + filtres, sur l'ensemble du catalogue. */
export default function SearchScreen() {
  const theme = useTheme();

  const [search, setSearch] = useState('');
  const [colors, setColors] = useState<CardColor[]>([]);
  const [categories, setCategories] = useState<CardCategory[]>([]);
  const [rarities, setRarities] = useState<string[]>([]);
  const [baseArtOnly, setBaseArtOnly] = useState(false);

  // Évite de relancer une requête à chaque frappe.
  const deferredSearch = useDeferredValue(search);

  const { data: facets } = useQuery({ queryKey: ['facets'], queryFn: fetchFacets });
  const { edition } = useEdition();

  const query: CardQuery = useMemo(
    () => ({
      search: deferredSearch.trim() || undefined,
      colors: colors.length ? colors : undefined,
      categories: categories.length ? categories : undefined,
      rarities: rarities.length ? rarities : undefined,
      baseArtOnly: baseArtOnly || undefined,
      // La recherche reste dans l'édition choisie : chercher « Zoro » ne doit
      // pas rendre trois fois la même carte parce qu'elle existe en trois langues.
      language: edition,
      sort: 'code',
      order: 'asc',
    }),
    [deferredSearch, colors, categories, rarities, baseArtOnly, edition],
  );

  function toggle<T>(list: T[], value: T, setter: (next: T[]) => void): void {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.searchBar, styles.searchBarInner, { borderColor: theme.border }]}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Nom, code (OP01-001), effet…"
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.text, backgroundColor: theme.surface }]}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <CardGrid
        query={query}
        header={
          <View style={styles.filters}>
            <FilterRow label="Couleur">
              {COLORS.map((color) => (
                <Chip
                  key={color}
                  label={color}
                  active={colors.includes(color)}
                  activeColor={COLOR_HEX[color]}
                  onPress={() => toggle(colors, color, setColors)}
                />
              ))}
            </FilterRow>

            <FilterRow label="Type">
              {CATEGORIES.map((category) => (
                <Chip
                  key={category}
                  label={CATEGORY_LABELS[category]}
                  active={categories.includes(category)}
                  onPress={() => toggle(categories, category, setCategories)}
                />
              ))}
            </FilterRow>

            {facets?.rarities.length ? (
              <FilterRow label="Rareté">
                {facets.rarities.map((rarity) => (
                  <Chip
                    key={rarity}
                    label={rarity}
                    active={rarities.includes(rarity)}
                    onPress={() => toggle(rarities, rarity, setRarities)}
                  />
                ))}
              </FilterRow>
            ) : null}

            <FilterRow label="Illustrations">
              <Chip
                label="Masquer les alt-arts"
                active={baseArtOnly}
                onPress={() => setBaseArtOnly(!baseArtOnly)}
              />
            </FilterRow>
          </View>
        }
        emptyTitle="Aucun résultat"
        emptyDescription="Essaie un autre terme, ou retire quelques filtres."
      />
    </View>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.filterRow}>
      <Text style={[styles.filterLabel, { color: theme.textMuted }]}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {children}
      </ScrollView>
    </View>
  );
}

function Chip({
  label,
  active,
  activeColor,
  onPress,
}: {
  label: string;
  active: boolean;
  activeColor?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const tint = activeColor ?? theme.accent;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? `${tint}22` : theme.surface,
          borderColor: active ? tint : theme.border,
        },
      ]}>
      <Text style={{ color: active ? theme.text : theme.textSecondary, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBarInner: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
  input: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 15,
  },
  filters: {
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  filterRow: {
    gap: Spacing.xs,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chips: {
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm - 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
});
