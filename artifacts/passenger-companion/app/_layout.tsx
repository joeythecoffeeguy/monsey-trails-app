import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConnectedPassengerAccount } from '@/lib/passenger-account';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

setBaseUrl(process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '');
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;
Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: Boolean(notification.request.content.sound),
    shouldSetBadge: false,
  }),
});
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('passenger-alerts', {
    name: 'Passenger stop alerts', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250],
  }).catch(() => undefined);
  Notifications.setNotificationChannelAsync('passenger-alerts-quiet', {
    name: 'Quiet passenger stop alerts',
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
    vibrationPattern: null,
  }).catch(() => undefined);
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function PassengerAuthBridge() {
  const { isLoaded, userId, getToken } = useAuth();
  const previousUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    setAuthTokenGetter(isLoaded && userId ? () => getToken() : null);
    if (isLoaded) {
      if (previousUser.current !== undefined && previousUser.current !== userId) {
        queryClient.clear();
      }
      previousUser.current = userId ?? null;
    }
    return () => setAuthTokenGetter(null);
  }, [isLoaded, userId, getToken]);
  return null;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          {publishableKey ? (
            <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
              <ConnectedPassengerAccount>
                <PassengerAuthBridge />
                <GestureHandlerRootView>
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </ConnectedPassengerAccount>
            </ClerkProvider>
          ) : (
            <GestureHandlerRootView>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </GestureHandlerRootView>
          )}
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
