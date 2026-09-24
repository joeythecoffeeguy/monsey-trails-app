import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText } from '@/components/AppText';
import { useColors } from '@/hooks/useColors';

export function AccountUnavailable() {
  const router = useRouter();
  const colors = useColors();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 18, backgroundColor: colors.background }}>
      <AppText style={{ fontSize: 25, fontWeight: '700', color: colors.foreground }}>Sign-in unavailable</AppText>
      <AppText style={{ fontSize: 16, lineHeight: 24, color: colors.mutedForeground }}>
        Accounts cannot load right now. You can still browse schedules and live trip information without signing in.
      </AppText>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace('/')}
        style={{ backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center' }}
      >
        <AppText style={{ color: colors.primaryForeground, fontWeight: '700' }}>Continue as guest</AppText>
      </Pressable>
    </View>
  );
}