import {
  CONDITION_LABELS,
  MARKETPLACE_LABELS,
  type CardCondition,
  type PriceQuote,
} from '@op/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { PriceChart } from '@/components/price-chart';
import { QuantityStepper } from '@/components/quantity-stepper';
import { Badge, Card as Panel, ColorDots, ErrorState, Loading, SectionTitle } from '@/components/ui';
import { CARD_ASPECT_RATIO, MAX_CONTENT_WIDTH, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchCard, fetchPrices } from '@/lib/api';
import { formatPrice, formatTrend } from '@/lib/format';
import { adjustQuantity, getCardEntries } from '@/lib/storage';

const CONDITIONS: CardCondition[] = ['NM', 'EX', 'GD', 'PL'];

/** Fiche détaillée d'une carte : visuel, texte, prix, historique, possession. */
export default function CardScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [quantities, setQuantities] = useState<Record<CardCondition, number>>({
    NM: 0,
    EX: 0,
    GD: 0,
    PL: 0,
    M: 0,
    LP: 0,
    PO: 0,
  });

  const cardQuery = useQuery({ queryKey: ['card', id], queryFn: () => fetchCard(id) });
  const priceQuery = useQuery({
    queryKey: ['prices', id],
    queryFn: () => fetchPrices(id, 30),
    // Les prix se rafraîchissent une fois par jour côté serveur.
    staleTime: 60 * 60 * 1000,
  });

  const loadQuantities = useCallback(async () => {
    const entries = await getCardEntries(id);
    const next = { NM: 0, EX: 0, GD: 0, PL: 0, M: 0, LP: 0, PO: 0 } as Record<
      CardCondition,
      number
    >;
    for (const entry of entries) next[entry.condition] += entry.quantity;
    setQuantities(next);
  }, [id]);

  useEffect(() => {
    void loadQuantities();
  }, [loadQuantities]);

  if (cardQuery.isLoading) return <Loading label="Chargement de la carte…" />;
  if (cardQuery.error) {
    return <ErrorState error={cardQuery.error} onRetry={() => void cardQuery.refetch()} />;
  }

  const card = cardQuery.data!.card;
  const variants = cardQuery.data!.variants;
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH) - Spacing.lg * 2;
  const imageWidth = Math.min(contentWidth, 320);

  async function setQuantity(condition: CardCondition, next: number): Promise<void> {
    const delta = next - quantities[condition];
    if (delta === 0) return;
    await adjustQuantity(id, delta, { condition, language: card.language });
    await loadQuantities();
  }

  const owned = Object.values(quantities).reduce((a, b) => a + b, 0);

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: card.code }} />

      <Image
        source={card.imageUrl ? { uri: card.imageUrl } : undefined}
        style={[
          styles.image,
          {
            width: imageWidth,
            height: imageWidth / CARD_ASPECT_RATIO,
            backgroundColor: theme.surfaceElevated,
          },
        ]}
        contentFit="contain"
        transition={200}
        cachePolicy="disk"
      />

      <View style={styles.titleBlock}>
        <Text style={[styles.name, { color: theme.text }]}>{card.name}</Text>
        <View style={styles.badges}>
          <Badge label={card.code} />
          {card.rarity ? <Badge label={card.rarity} color={theme.accent} /> : null}
          <Badge label={card.category} />
          <ColorDots colors={card.colors} />
        </View>
        <Pressable
          onPress={() => router.push({ pathname: '/set/[id]', params: { id: card.setId } })}>
          <Text style={[styles.setLink, { color: theme.accent }]}>{card.setName} ›</Text>
        </Pressable>
      </View>

      {/* ------------------------------------------------------------------ */}
      <SectionTitle>Prix actuels</SectionTitle>
      <Panel style={{ padding: 0 }}>
        {priceQuery.isLoading ? (
          <Loading />
        ) : (priceQuery.data?.quotes.length ?? 0) > 0 ? (
          priceQuery.data!.quotes.map((quote, index) => (
            <QuoteRow key={`${quote.marketplace}-${quote.foil}`} quote={quote} first={index === 0} />
          ))
        ) : (
          <View style={{ padding: Spacing.lg }}>
            <Text style={{ color: theme.textSecondary, lineHeight: 20 }}>
              Aucun relevé pour cette carte. Les prix apparaissent après la première
              synchronisation, une fois les clés Cardmarket / TCGplayer / eBay renseignées côté
              backend.
            </Text>
          </View>
        )}
      </Panel>

      {/* ------------------------------------------------------------------ */}
      <SectionTitle>Historique (30 jours)</SectionTitle>
      {priceQuery.data ? (
        <PriceChart history={priceQuery.data.history} width={contentWidth} />
      ) : (
        <Loading />
      )}

      {/* ------------------------------------------------------------------ */}
      <SectionTitle
        action={
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>
            {owned > 0 ? `${owned} exemplaire${owned > 1 ? 's' : ''}` : 'Non possédée'}
          </Text>
        }>
        Ma collection
      </SectionTitle>
      <Panel>
        <View style={{ gap: Spacing.md }}>
          {CONDITIONS.map((condition) => (
            <QuantityStepper
              key={condition}
              label={CONDITION_LABELS[condition]}
              value={quantities[condition]}
              onChange={(next) => void setQuantity(condition, next)}
            />
          ))}
        </View>
      </Panel>

      {/* ------------------------------------------------------------------ */}
      {card.effect || card.trigger ? (
        <>
          <SectionTitle>Effet</SectionTitle>
          <Panel>
            {card.effect ? (
              <Text style={[styles.effect, { color: theme.text }]}>{card.effect}</Text>
            ) : null}
            {card.trigger ? (
              <Text style={[styles.effect, { color: theme.textSecondary, marginTop: Spacing.md }]}>
                {card.trigger}
              </Text>
            ) : null}
          </Panel>
        </>
      ) : null}

      <SectionTitle>Caractéristiques</SectionTitle>
      <Panel>
        <Stat label="Coût" value={card.cost} />
        <Stat label="Puissance" value={card.power} />
        <Stat label="Contre" value={card.counter} />
        <Stat label="Vie" value={card.life} />
        <Stat label="Attribut" value={card.attributes.join(', ') || null} />
        <Stat label="Traits" value={card.types.join(' / ') || null} />
        <Stat label="Langue" value={card.language} />
      </Panel>

      {variants.length > 0 ? (
        <>
          <SectionTitle>Autres illustrations</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.variants}>
            {variants.map((variant) => (
              <Pressable
                key={variant.id}
                onPress={() =>
                  router.push({ pathname: '/card/[id]', params: { id: variant.id } })
                }>
                <Image
                  source={variant.imageUrl ? { uri: variant.imageUrl } : undefined}
                  style={[styles.variantImage, { backgroundColor: theme.surfaceElevated }]}
                  contentFit="cover"
                  cachePolicy="disk"
                />
                <Text style={[styles.variantLabel, { color: theme.textMuted }]}>
                  {variant.artVariant === 0 ? 'Base' : `Alt ${variant.artVariant}`}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
    </ScrollView>
  );
}

function QuoteRow({ quote, first }: { quote: PriceQuote; first: boolean }) {
  const theme = useTheme();
  const variation =
    quote.avg7 !== null && quote.market !== null && quote.avg7 > 0
      ? ((quote.market - quote.avg7) / quote.avg7) * 100
      : null;

  return (
    <Pressable
      onPress={() => {
        if (quote.url) void Linking.openURL(quote.url);
      }}
      style={[
        styles.quoteRow,
        { borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.border },
      ]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.quoteName, { color: theme.text }]}>
          {MARKETPLACE_LABELS[quote.marketplace]}
          {quote.foil ? ' · Foil' : ''}
        </Text>
        <Text style={[styles.quoteMeta, { color: theme.textMuted }]}>
          min. {formatPrice(quote.low, quote.currency)}
          {quote.listingCount ? ` · ${quote.listingCount} offres` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.quotePrice, { color: theme.text }]}>
          {formatPrice(quote.market, quote.currency)}
        </Text>
        {variation !== null ? (
          <Text
            style={{
              fontSize: 12,
              color: variation >= 0 ? theme.positive : theme.negative,
            }}>
            {formatTrend(variation)} / 7 j
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  const theme = useTheme();
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.stat}>
      <Text style={{ color: theme.textSecondary, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{value}</Text>
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
  image: {
    alignSelf: 'center',
    borderRadius: Radius.md,
  },
  titleBlock: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  setLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  quoteName: {
    fontSize: 15,
    fontWeight: '600',
  },
  quoteMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  quotePrice: {
    fontSize: 17,
    fontWeight: '700',
  },
  effect: {
    fontSize: 14,
    lineHeight: 21,
  },
  stat: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm - 2,
  },
  variants: {
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  variantImage: {
    width: 84,
    height: 84 / CARD_ASPECT_RATIO,
    borderRadius: Radius.sm,
  },
  variantLabel: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
});
