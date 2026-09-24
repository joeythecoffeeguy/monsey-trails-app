import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppText } from '@/components/AppText';
import { useColors } from '@/hooks/useColors';

type Coordinate = { lat: number; lng: number };
export type InteractiveJourneyMapStop = Coordinate & {
  id: string;
  label: string;
  note?: string | null;
  status?: 'upcoming' | 'current' | 'completed';
};
export type InteractiveJourneyMapProps = {
  stops: InteractiveJourneyMapStop[];
  routeGeometry?: Coordinate[];
  coachLocation?: Coordinate | null;
  coachLocationUpdatedAt?: string | null;
  coachLocationVisibility?: 'live' | 'hidden' | 'stale' | 'unavailable';
  unavailable?: boolean;
  stale?: boolean;
  selectedStopId?: string | null;
  onSelectStop?: (stopId: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// react-native-maps is native-only. Keep Expo's web preview useful without
// suggesting that this static web fallback is the iPhone's interactive map.
export function InteractiveJourneyMap({ stops, style, testID }: InteractiveJourneyMapProps) {
  const theme = useColors();
  return (
    <View style={[styles.container, { backgroundColor: theme.muted }, style]} testID={testID}>
      <AppText style={[styles.title, { color: theme.foreground }]}>Interactive map available in the iPhone app</AppText>
      <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
        {stops.length ? `${stops.length} published stops on this journey` : 'Stop locations are being prepared.'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 240, borderRadius: 14, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  detail: { fontSize: 13, marginTop: 8, textAlign: 'center' },
});