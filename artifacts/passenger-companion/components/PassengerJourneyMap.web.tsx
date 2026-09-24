import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { useColors } from '@/hooks/useColors';
import type { PassengerJourneyMapProps } from './PassengerJourneyMap.native';

// The interactive native map is available on iPhone. Keep web previews useful
// without importing a native-only map module into the browser bundle.
export function PassengerJourneyMap({ stops, selectedStopId, onSelectStop, status }: PassengerJourneyMapProps) {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.muted }]}>
      <AppText style={{ color: colors.foreground, fontWeight: '700' }}>{status}</AppText>
      <AppText style={{ color: colors.mutedForeground, fontSize: 12 }}>Open on iPhone to explore the interactive map.</AppText>
      {stops.map((stop, index) => (
        <Pressable
          key={stop.id}
          onPress={() => onSelectStop(stop.id)}
          accessibilityRole="button"
          accessibilityLabel={`Select stop ${index + 1}: ${stop.label}`}
          style={[styles.stop, { backgroundColor: selectedStopId === stop.id ? colors.primary : colors.card }]}
        >
          <AppText style={{ color: colors.foreground }} numberOfLines={1}>{index + 1}. {stop.label}</AppText>
        </Pressable>
      ))}
      {selectedStopId && <Pressable onPress={() => onSelectStop(null)} accessibilityRole="button">
        <AppText style={{ color: colors.foreground }}>Show full route</AppText>
      </Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: 6, padding: 16 },
  stop: { borderRadius: 8, padding: 6 },
});