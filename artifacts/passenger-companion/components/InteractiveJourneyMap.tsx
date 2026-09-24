import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Callout, Marker, Polyline } from 'react-native-maps';
import { Feather } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { useColors } from '@/hooks/useColors';

export type JourneyMapCoordinate = {
  lat: number;
  lng: number;
};

export type InteractiveJourneyMapStop = JourneyMapCoordinate & {
  id: string;
  label: string;
  note?: string | null;
  status?: 'upcoming' | 'current' | 'completed';
};

export type InteractiveJourneyMapProps = {
  /** Published, verified stops. Invalid coordinates are ignored rather than plotted. */
  stops: InteractiveJourneyMapStop[];
  /** The real route geometry supplied by the trip; no geometry is inferred here. */
  routeGeometry?: JourneyMapCoordinate[];
  /** A privacy-approved coach position. Pass null when the server withholds it. */
  coachLocation?: JourneyMapCoordinate | null;
  coachLocationUpdatedAt?: string | null;
  /** Defaults to live for backwards-compatible use with an already privacy-filtered location. */
  coachLocationVisibility?: 'live' | 'hidden' | 'stale' | 'unavailable';
  /** Explicitly suppresses a marker while the trip is unavailable or its data is stale. */
  unavailable?: boolean;
  stale?: boolean;
  selectedStopId?: string | null;
  onSelectStop?: (stopId: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const MAX_LIVE_LOCATION_AGE_MS = 90_000;
const DEFAULT_REGION = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

function validCoordinate(value: JourneyMapCoordinate): boolean {
  return Number.isFinite(value.lat)
    && Number.isFinite(value.lng)
    && value.lat >= -90
    && value.lat <= 90
    && value.lng >= -180
    && value.lng <= 180;
}

function toLatLng(value: JourneyMapCoordinate) {
  return { latitude: value.lat, longitude: value.lng };
}

function locationIsFresh(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const age = Date.now() - new Date(updatedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= MAX_LIVE_LOCATION_AGE_MS;
}

/**
 * Native, pannable/zoomable journey map. The map never invents route points or
 * coach positions: only coordinates supplied by the server are rendered.
 */
export function InteractiveJourneyMap({
  stops,
  routeGeometry = [],
  coachLocation = null,
  coachLocationUpdatedAt = null,
  coachLocationVisibility = 'live',
  unavailable = false,
  stale = false,
  selectedStopId = null,
  onSelectStop,
  style,
  testID = 'interactive-journey-map',
}: InteractiveJourneyMapProps) {
  const theme = useColors();
  const mapRef = useRef<MapView | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const lastViewportKey = useRef<string | null>(null);
  const validStops = useMemo(() => stops.filter(validCoordinate), [stops]);
  const validRoute = useMemo(() => routeGeometry.filter(validCoordinate), [routeGeometry]);
  const validCoachLocation = coachLocation && validCoordinate(coachLocation) ? coachLocation : null;

  const coachIsVisible = Boolean(
    validCoachLocation
    && !unavailable
    && !stale
    && coachLocationVisibility === 'live'
    && locationIsFresh(coachLocationUpdatedAt),
  );

  const viewportCoordinates = useMemo(
    () => [
      ...validRoute,
      ...validStops,
      ...(coachIsVisible && validCoachLocation ? [validCoachLocation] : []),
    ].map(toLatLng),
    [validRoute, validStops, coachIsVisible, validCoachLocation],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || viewportCoordinates.length === 0) return;

    const selected = selectedStopId
      ? validStops.find(stop => stop.id === selectedStopId)
      : undefined;
    const viewportKey = selected
      ? `selected:${selected.id}:${selected.lat}:${selected.lng}`
      : [...validRoute, ...validStops].map(point => `${point.lat}:${point.lng}`).join('|');
    if (lastViewportKey.current === viewportKey) return;
    lastViewportKey.current = viewportKey;

    if (selected) {
      map.animateToRegion({
        ...toLatLng(selected),
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      }, 350);
    } else {
      map.fitToCoordinates(viewportCoordinates, {
        edgePadding: { top: 40, right: 40, bottom: 56, left: 40 },
        animated: true,
      });
    }
  }, [mapReady, selectedStopId, validRoute, validStops, viewportCoordinates]);

  return (
    <View style={[styles.container, style]} testID={testID}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        mapType="standard"
        showsCompass
        showsScale
        toolbarEnabled={false}
        loadingEnabled
        onMapReady={() => setMapReady(true)}
        accessibilityLabel="Interactive journey map"
      >
        {validRoute.length > 1 && (
          <Polyline
            coordinates={validRoute.map(toLatLng)}
            strokeColor={theme.primary}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {validStops.map((stop, index) => {
          const selected = stop.id === selectedStopId;
          const completed = stop.status === 'completed';
          const current = stop.status === 'current';
          return (
            <Marker
              key={stop.id}
              coordinate={toLatLng(stop)}
              title={`Stop ${index + 1}: ${stop.label}`}
              accessibilityLabel={`Stop ${index + 1}: ${stop.label}`}
              onPress={() => { if (!completed) onSelectStop?.(stop.id); }}
              tracksViewChanges={false}
            >
              <View style={[
                styles.stopMarker,
                { backgroundColor: completed ? theme.success : selected || current ? theme.secondary : theme.card, borderColor: theme.secondary },
                selected && styles.selectedStopMarker,
              ]}>
                <AppText style={[
                  styles.stopNumber,
                  { color: completed || selected || current ? theme.secondaryForeground : theme.secondary },
                ]}>{index + 1}</AppText>
              </View>
              <Callout onPress={() => { if (!completed) onSelectStop?.(stop.id); }}>
                <View style={styles.callout}>
                  <AppText style={[styles.calloutTitle, { color: theme.foreground }]}>{stop.label}</AppText>
                  {stop.note ? <AppText style={[styles.calloutNote, { color: theme.mutedForeground }]}>{stop.note}</AppText> : null}
                </View>
              </Callout>
            </Marker>
          );
        })}
        {coachIsVisible && validCoachLocation ? (
          <Marker
            coordinate={toLatLng(validCoachLocation)}
            title="Live coach location"
            accessibilityLabel="Live coach location"
            pinColor={theme.primary}
            zIndex={10}
          >
            <View style={[styles.coachMarker, { backgroundColor: theme.secondary, borderColor: theme.primary }]}>
              <Feather name="navigation" size={18} color={theme.primary} />
            </View>
          </Marker>
        ) : null}
      </MapView>
      {(unavailable || stale) ? (
        <View style={[styles.statusBanner, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Feather name="map-pin" size={16} color={theme.mutedForeground} />
          <AppText style={[styles.statusText, { color: theme.mutedForeground }]}>
            {stale ? 'Map data is temporarily out of date.' : 'Map data is temporarily unavailable.'}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minHeight: 240, overflow: 'hidden', borderRadius: 14 },
  stopMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  selectedStopMarker: { width: 34, height: 34, borderRadius: 17 },
  stopNumber: { fontSize: 11, fontWeight: '800' },
  coachMarker: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  callout: { minWidth: 140, maxWidth: 240, padding: 10 },
  calloutTitle: { fontSize: 13, fontWeight: '800' },
  calloutNote: { marginTop: 4, fontSize: 12, lineHeight: 17 },
  statusBanner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: { flex: 1, fontSize: 12, fontWeight: '700' },
});