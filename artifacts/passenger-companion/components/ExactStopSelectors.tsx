import React, { useEffect, useMemo, useState } from 'react';
import { AppText } from '@/components/AppText';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  getPassengerJourney,
  type OfficialScheduleRun,
  type PassengerJourney,
  type PassengerJourneyStop,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import type { StopChoice } from '@/lib/companion-preferences';
import { filterItemsServingExactStops } from '@/lib/exact-stop-selection';
import { passengerStopIdentity } from '@workspace/passenger-stop-label';
import { Surface } from './Surface';

export type VerifiedRunStops = { run: OfficialScheduleRun; journey: PassengerJourney };

export function useExactRunStops(params: {
  runs: OfficialScheduleRun[];
  date: string;
  line: number;
  origin: number;
  destination: number;
  pickup: StopChoice | null;
  dropoff: StopChoice | null;
}) {
  const { runs, date, line, origin, destination, pickup, dropoff } = params;
  const [runStops, setRunStops] = useState<VerifiedRunStops[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const runsKey = runs.map(run => run.id).join('|');

  useEffect(() => {
    const controller = new AbortController();
    if (!runs.length) {
      setRunStops(previous => previous.length ? [] : previous);
      setLoading(false);
      setError('');
      return () => controller.abort();
    }
    setLoading(true);
    setError('');
    void Promise.allSettled(runs.map(run => getPassengerJourney({
      date,
      line: line as 1 | 2 | 3,
      origin,
      destination,
      runId: run.id,
    }, { signal: controller.signal }))).then(results => {
      if (controller.signal.aborted) return;
      const loaded: VerifiedRunStops[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') loaded.push({ run: runs[index], journey: result.value });
      });
      setRunStops(loaded);
      setError(loaded.length === runs.length ? '' : loaded.length
        ? `Exact stops could not be verified for ${runs.length - loaded.length} runs. They remain visible until you apply an exact-stop filter.`
        : 'Exact serving stops could not be loaded. Retry the schedule refresh.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [date, destination, line, origin, runsKey]);

  const pickupStops = useMemo(
    () => uniqueStops(runStops.flatMap(item => item.journey.stops.filter(stop => stop.kind === 'pickup'))),
    [runStops],
  );
  const dropoffStops = useMemo(() => {
    const eligible = pickup
      ? runStops.filter(item => serves(item, pickup))
      : runStops;
    return uniqueStops(eligible.flatMap(item => item.journey.stops.filter(stop => stop.kind === 'dropoff')));
  }, [pickup, runStops]);
  const filteredRuns = useMemo(() => {
    if (pickup && dropoff) return filterRunsServingExactStops(runStops, pickup, dropoff);
    if (pickup) return runStops.filter(item => serves(item, pickup)).map(item => item.run);
    if (dropoff) return runStops.filter(item => serves(item, dropoff)).map(item => item.run);
    return runs;
  }, [dropoff, pickup, runStops, runs]);

  return { pickupStops, dropoffStops, filteredRuns, runStops, loading, error };
}

function serves(item: VerifiedRunStops, selected: StopChoice) {
  return item.journey.stops.some(stop =>
    stop.kind === selected.kind && passengerStopIdentity(stop) === passengerStopIdentity(selected));
}

export function uniqueStops(stops: PassengerJourneyStop[]): StopChoice[] {
  const byId = new Map<string, StopChoice>();
  stops.forEach(stop => {
    const key = passengerStopIdentity(stop);
    if (!byId.has(key)) {
      byId.set(key, { id: stop.id, label: stop.label, kind: stop.kind, lat: stop.lat, lng: stop.lng });
    }
  });
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function filterRunsServingExactStops(
  items: VerifiedRunStops[],
  pickup: StopChoice,
  dropoff: StopChoice,
) {
  return filterItemsServingExactStops(
    items.map(item => ({ value: item.run, stops: item.journey.stops })),
    pickup,
    dropoff,
  );
}

export function ExactStopSelectors({
  pickup,
  dropoff,
  pickupStops,
  dropoffStops,
  loading,
  error,
  originName,
  destinationName,
  mode = 'filter',
  disabled = false,
  onPickup,
  onDropoff,
}: {
  pickup: StopChoice | null;
  dropoff: StopChoice | null;
  pickupStops: StopChoice[];
  dropoffStops: StopChoice[];
  loading: boolean;
  error: string;
  originName?: string;
  destinationName?: string;
  mode?: 'filter' | 'trip';
  disabled?: boolean;
  onPickup: (stop: StopChoice | null) => void;
  onDropoff: (stop: StopChoice | null) => void;
}) {
  const theme = useColors();
  const [selecting, setSelecting] = useState<'pickup' | 'dropoff' | null>(null);
  const options = selecting === 'pickup' ? pickupStops : dropoffStops;

  const triggerSelect = (type: 'pickup' | 'dropoff') => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelecting(type);
  };

  const handleChoose = (stop: StopChoice | null) => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (selecting === 'pickup') onPickup(stop);
    else onDropoff(stop);
    setSelecting(null);
  };

  return (
    <Surface variant="card" style={[styles.card, { borderColor: theme.border }]}>
      <AppText style={[styles.title, { color: theme.foreground }]}>
        {mode === 'trip' ? 'Choose your boarding stops' : 'Filter by exact stops'}
      </AppText>
      <AppText style={[styles.help, { color: theme.mutedForeground }]}>
        {mode === 'trip'
          ? disabled
            ? 'Turn off your active stop alert before changing stops.'
            : 'Browse this trip freely. Choose a verified pickup and drop-off before using boarding directions or setting a stop alert.'
          : 'Choose stops to filter published runs. You can browse any trip before deciding where to board.'}
      </AppText>
      
      <Pressable
        style={({ pressed }) => [styles.selector, { borderColor: theme.border }, pressed && { backgroundColor: theme.muted }]}
        onPress={() => triggerSelect('pickup')}
        disabled={disabled || loading || pickupStops.length === 0}
        accessibilityRole="button"
        accessibilityLabel={`Exact pickup. ${pickup?.label ?? 'Any verified pickup'}`}
        testID="exact-pickup-selector"
      >
        <View style={styles.grow}>
          <AppText style={[styles.label, { color: theme.mutedForeground }]}>
            {originName ? `PICKUP IN ${originName.toUpperCase()}` : 'EXACT PICKUP'}
          </AppText>
          <AppText style={[styles.value, { color: theme.foreground }]}>
            {pickup?.label ?? (loading ? 'Loading serving stops…' : 'Any verified pickup')}
          </AppText>
        </View>
        <Feather name="chevron-down" size={20} color={theme.primary} />
      </Pressable>
      
      <Pressable
        style={({ pressed }) => [styles.selector, { borderColor: theme.border }, pressed && { backgroundColor: theme.muted }]}
        onPress={() => triggerSelect('dropoff')}
        disabled={disabled || loading || dropoffStops.length === 0}
        accessibilityRole="button"
        accessibilityLabel={`Exact drop-off. ${dropoff?.label ?? 'Any verified drop-off'}`}
        testID="exact-dropoff-selector"
      >
        <View style={styles.grow}>
          <AppText style={[styles.label, { color: theme.mutedForeground }]}>
            {destinationName ? `DROP-OFF IN ${destinationName.toUpperCase()}` : 'EXACT DROP-OFF'}
          </AppText>
          <AppText style={[styles.value, { color: theme.foreground }]}>
            {dropoff?.label ?? (loading ? 'Loading serving stops…' : 'Any verified drop-off')}
          </AppText>
        </View>
        <Feather name="chevron-down" size={20} color={theme.primary} />
      </Pressable>
      
      {error ? <AppText style={[styles.error, { color: theme.arrival }]} accessibilityRole="alert">{error}</AppText> : null}
      
      <Modal visible={selecting !== null} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setSelecting(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={[styles.modalHeader, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <AppText style={[styles.modalTitle, { color: theme.foreground }]}>Exact {selecting === 'pickup' ? 'pickup' : 'drop-off'}</AppText>
            <Pressable 
              onPress={() => setSelecting(null)} 
              accessibilityLabel="Close exact stop selector"
              style={({ pressed }) => [styles.modalCloseBtn, pressed && { opacity: 0.5 }]}
            >
              <AppText style={[styles.modalCloseText, { color: theme.primary }]}>Done</AppText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <Pressable
              style={({ pressed }) => [
                styles.option,
                { borderColor: theme.border, backgroundColor: theme.card },
                pressed && { backgroundColor: theme.muted }
              ]}
              onPress={() => handleChoose(null)}
              accessibilityRole="radio"
              accessibilityState={{ checked: (selecting === 'pickup' ? !pickup : !dropoff) }}
              testID="exact-stop-any"
            >
              <AppText style={[styles.optionText, { color: theme.foreground }]}>Any verified {selecting === 'pickup' ? 'pickup' : 'drop-off'}</AppText>
              {(selecting === 'pickup' ? !pickup : !dropoff) && <Feather name="check" size={20} color={theme.primary} />}
            </Pressable>
            {options.map(stop => {
              const isSelected = (selecting === 'pickup' ? pickup?.id : dropoff?.id) === stop.id;
              return (
                <Pressable
                  key={stop.id}
                  style={({ pressed }) => [
                    styles.option, 
                    { borderColor: theme.border, backgroundColor: theme.card },
                    pressed && { backgroundColor: theme.muted }
                  ]}
                  onPress={() => handleChoose(stop)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  testID={`exact-stop-${stop.id}`}
                >
                  <AppText style={[styles.optionText, { color: theme.foreground }]}>{stop.label}</AppText>
                  {isSelected && <Feather name="check" size={20} color={theme.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 18, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '800' },
  help: { fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 16 },
  selector: { minHeight: 68, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectorIconBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  value: { fontSize: 16, fontWeight: '600', marginTop: 2 },
  error: { fontSize: 13, fontWeight: '700', lineHeight: 19, marginTop: 12 },
  
  modalHeader: { minHeight: 64, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalCloseBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  modalCloseText: { fontSize: 17, fontWeight: '600' },
  modalScroll: { padding: 16, gap: 8 },
  option: { minHeight: 60, paddingHorizontal: 20, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionText: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 12 },
});
