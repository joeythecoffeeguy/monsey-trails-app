import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { AppText } from '@/components/AppText';
import { useColors } from '@/hooks/useColors';
import type { MapPoint, MapStop } from '@/lib/journey-map';

export type PassengerJourneyMapProps = {
  route: MapPoint[];
  stops: MapStop[];
  liveCoach: MapPoint | null;
  selectedStopId: string | null;
  onSelectStop: (id: string | null) => void;
  status: string;
};

export function PassengerJourneyMap({
  route, stops, liveCoach, selectedStopId, onSelectStop, status,
}: PassengerJourneyMapProps) {
  const colors = useColors();
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const lastViewport = useRef('');
  const selected = stops.find(stop => stop.id === selectedStopId);
  const points = useMemo(() => [...route, ...stops, ...(liveCoach ? [liveCoach] : [])], [route, stops, liveCoach]);
  const initial = points[0];
  const boundsKey = `${stops.map(s => `${s.id}:${s.latitude}:${s.longitude}`).join('|')}/${route.length}`;

  useEffect(() => {
    if (!ready || !initial) return;
    const key = selected
      ? `stop:${selected.id}:${selected.latitude}:${selected.longitude}`
      : `route:${boundsKey}`;
    if (lastViewport.current === key) return;
    lastViewport.current = key;
    if (selected) {
      map.current?.animateToRegion({
        latitude: selected.latitude, longitude: selected.longitude,
        latitudeDelta: 0.008, longitudeDelta: 0.008,
      }, 350);
    } else if (points.length > 1) {
      map.current?.fitToCoordinates(points, {
        edgePadding: { top: 48, right: 36, bottom: 56, left: 36 },
        animated: true,
      });
    } else {
      map.current?.animateToRegion({
        latitude: initial.latitude, longitude: initial.longitude,
        latitudeDelta: 0.02, longitudeDelta: 0.02,
      }, 350);
    }
  }, [ready, selected, boundsKey, initial, points]);

  if (!initial) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.muted }]}>
        <Feather name="map" size={26} color={colors.mutedForeground} />
        <AppText style={[styles.emptyTitle, { color: colors.foreground }]}>Map not available yet</AppText>
        <AppText style={[styles.emptyCopy, { color: colors.mutedForeground }]}>
          Verified stop coordinates and a route have not been provided for this trip.
        </AppText>
        <AppText style={[styles.status, { color: colors.foreground, backgroundColor: colors.card }]}>{status}</AppText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...initial, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        onMapReady={() => setReady(true)}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        testID="passenger-journey-map"
      >
        {route.length > 1 && (
          <>
            <Polyline coordinates={route} strokeColor={colors.secondary} strokeWidth={8} />
            <Polyline coordinates={route} strokeColor={colors.primary} strokeWidth={4} />
          </>
        )}
        {stops.map((stop, index) => {
          const active = selectedStopId === stop.id || stop.status === 'current';
          const completed = stop.status === 'completed';
          return (
            <Marker
              key={stop.id}
              coordinate={stop}
              title={`Stop ${index + 1}: ${stop.label}`}
              onPress={() => onSelectStop(stop.id)}
              accessibilityLabel={`Select stop ${index + 1}: ${stop.label}`}
              testID={`map-stop-${stop.id}`}
            >
              <View style={[
                styles.stopPin,
                { backgroundColor: completed ? colors.success : active ? colors.secondary : colors.card,
                  borderColor: completed ? colors.success : colors.secondary },
              ]}>
                <AppText style={[styles.stopNumber, { color: completed || active ? colors.secondaryForeground : colors.secondary }]}>
                  {index + 1}
                </AppText>
              </View>
            </Marker>
          );
        })}
        {liveCoach && (
          <Marker coordinate={liveCoach} title="Live coach location" accessibilityLabel="Live coach location" zIndex={10} testID="live-coach-marker">
            <View style={[styles.coachPin, { backgroundColor: colors.secondary, borderColor: colors.card }]}>
              <Feather name="navigation" size={19} color={colors.primary} />
            </View>
          </Marker>
        )}
      </MapView>
      <View style={[styles.statusChip, { backgroundColor: colors.card }]} pointerEvents="none">
        <Feather name={liveCoach ? 'navigation' : 'map-pin'} size={14} color={colors.secondary} />
        <AppText style={[styles.statusText, { color: colors.foreground }]} numberOfLines={2}>{status}</AppText>
      </View>
      {selected && (
        <Pressable
          style={[styles.fullRoute, { backgroundColor: colors.card }]}
          onPress={() => {
            // Refit even if this stop was selected after a manual pan.
            lastViewport.current = '';
            onSelectStop(null);
          }}
          accessibilityRole="button"
          accessibilityLabel="Show full route"
          testID="show-full-route"
        >
          <AppText style={{ color: colors.foreground, fontWeight: '700', fontSize: 12 }}>Full route</AppText>
        </Pressable>
      )}
      {selected && (
        <View style={[styles.stopChip, { backgroundColor: colors.card }]} pointerEvents="none">
          <AppText style={{ color: colors.foreground, fontWeight: '700', fontSize: 12 }} numberOfLines={2}>{selected.label}</AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22 },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginTop: 10 },
  emptyCopy: { textAlign: 'center', fontSize: 12, marginTop: 5 },
  status: { fontSize: 11, marginTop: 12, padding: 7, borderRadius: 8, textAlign: 'center' },
  statusChip: { position: 'absolute', top: 12, left: 12, maxWidth: '65%', padding: 9, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  fullRoute: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 12 },
  stopChip: { position: 'absolute', bottom: 25, left: 12, maxWidth: '72%', padding: 9, borderRadius: 10 },
  stopPin: { minWidth: 28, height: 28, borderWidth: 2, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  stopNumber: { fontSize: 12, fontWeight: '800' },
  coachPin: { height: 40, width: 40, borderWidth: 3, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});