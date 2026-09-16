import { MARKETPLACE_LABELS } from '@op/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card as Panel, SectionTitle } from '@/components/ui';
import { MAX_CONTENT_WIDTH, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchHealth, getBaseUrl, invalidateBaseUrl } from '@/lib/api';
import { setSetting } from '@/lib/storage';

/**
 * Réglages : essentiellement l'adresse du backend, plus l'état des sources de prix.
 * C'est aussi l'écran de diagnostic quand plus rien ne se charge.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getBaseUrl().then(setBaseUrl);
  }, []);

  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    retry: 0,
  });

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const cleaned = baseUrl.trim().replace(/\/+$/, '');
      await setSetting('apiBaseUrl', cleaned);
      invalidateBaseUrl();
      // Tout le cache dépend de l'adresse : on repart à zéro.
      await queryClient.invalidateQueries();
      Alert.alert('Enregistré', `Le backend utilisé est désormais ${cleaned}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}>
      <SectionTitle>Backend</SectionTitle>
      <Panel>
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          Adresse du serveur (API). En développement, utilise l&apos;IP locale de ta machine,
          pas « localhost » : le téléphone n&apos;est pas la machine.
        </Text>
        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.20:4000"
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.surfaceElevated, borderColor: theme.border },
          ]}
        />
        <Button label={saving ? 'Enregistrement…' : 'Enregistrer'} onPress={() => void save()} disabled={saving} />
      </Panel>

      <SectionTitle
        action={
          <Text style={{ color: health.data ? theme.positive : theme.negative, fontSize: 13 }}>
            {health.isLoading ? '…' : health.data ? 'en ligne' : 'hors ligne'}
          </Text>
        }>
        Sources de prix
      </SectionTitle>
      <Panel>
        {health.data ? (
          health.data.providers.map((provider) => (
            <View key={provider.marketplace} style={styles.providerRow}>
              <Text style={{ color: theme.text, fontSize: 15 }}>
                {MARKETPLACE_LABELS[provider.marketplace]}
              </Text>
              <Text
                style={{
                  color: provider.configured ? theme.positive : theme.textMuted,
                  fontSize: 13,
                  fontWeight: '600',
                }}>
                {provider.configured ? 'configurée' : 'clés manquantes'}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ color: theme.textSecondary, lineHeight: 20 }}>
            Backend injoignable. Vérifie qu&apos;il tourne (npm run api) et que l&apos;adresse
            ci-dessus est la bonne.
          </Text>
        )}
        <Text style={[styles.hint, { color: theme.textMuted }]}>
          Les clés se renseignent dans services/api/.env. Une source sans clé est simplement
          ignorée par le relevé quotidien ; les deux autres continuent de fonctionner.
        </Text>
      </Panel>

      <SectionTitle>À propos</SectionTitle>
      <Panel>
        <Text style={{ color: theme.textSecondary, lineHeight: 20 }}>
          Les prix proviennent des APIs officielles de Cardmarket, TCGplayer et eBay. Le backend
          en prend un relevé par jour : l&apos;historique se construit au fil du temps, et le
          premier mois est complété par les moyennes glissantes fournies par Cardmarket.
        </Text>
      </Panel>
    </ScrollView>
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
  label: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: Spacing.md,
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 15,
    marginBottom: Spacing.md,
  },
  providerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: Spacing.md,
  },
});
