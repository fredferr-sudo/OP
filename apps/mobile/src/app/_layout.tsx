import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { openDb } from '@/lib/storage';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Le catalogue bouge peu, les prix une fois par jour : inutile de rappeler
      // le backend à chaque navigation.
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

export default function RootLayout() {
  const scheme = useColorScheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // La base locale doit exister avant le premier rendu : réglages et
    // collection en dépendent.
    openDb()
      .catch((error) => console.error('Base locale indisponible', error))
      .finally(() => {
        setReady(true);
        void SplashScreen.hideAsync();
      });
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={scheme === 'light' ? DefaultTheme : DarkTheme}>
          <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="set/[id]" options={{ title: 'Extension' }} />
            <Stack.Screen name="card/[id]" options={{ title: 'Carte' }} />
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
