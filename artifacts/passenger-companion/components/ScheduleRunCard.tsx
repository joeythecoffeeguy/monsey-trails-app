import React, { useState } from 'react';
import { AppText } from '@/components/AppText';
import { Pressable, StyleSheet, View, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { OfficialScheduleRun, PassengerJourney } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { followingDayLabel, type PassengerLanguage } from '@/lib/companion-preferences';
import { isRtlLanguage, passengerCopy } from '@/lib/passenger-i18n';
import { Surface } from './Surface';

type Props = {
  run: OfficialScheduleRun;
  serviceDate: string;
  formatTime: (value: string | null) => string;
  language: PassengerLanguage;
  largeText: boolean;
  legend: ReadonlyArray<{ key: string; meaning: string }>;
  verifiedJourney?: PassengerJourney;
  canSelect?: boolean;
  onSelect: () => void;
  offline?: boolean;
  stale?: boolean;
};

export function ScheduleRunCard({ run, serviceDate, formatTime, language, largeText, legend, verifiedJourney, canSelect = true, onSelect, offline, stale }: Props) {
  const theme = useColors();
  const [expanded, setExpanded] = useState(false);
  const rtl = isRtlLanguage(language);
  const scale = largeText ? 1.18 : 1;
  const meanings = run.displayKeys.map(key => ({ key, meaning: legend.find(item => item.key === key)?.meaning }));

  const handlePress = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setExpanded(value => !value);
  };

  const handleSelect = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    onSelect();
  };

  let statusText = 'Scheduled';
  let statusBg = theme.muted;
  let statusColor = theme.foreground;

  if (offline) {
    statusText = 'Saved offline';
    statusBg = theme.muted;
    statusColor = theme.mutedForeground;
  } else if (stale && ['on_time', 'delayed', 'live_estimate'].includes(run.departureStatus)) {
    statusText = 'Status needs refresh';
    statusBg = theme.muted;
    statusColor = theme.mutedForeground;
  } else {
    switch (run.departureStatus) {
      case 'awaiting_departure':
        statusText = 'Scheduled';
        statusBg = theme.muted;
        statusColor = theme.foreground;
        break;
      case 'on_time':
        statusText = 'Live · on time';
        statusBg = theme.muted;
        statusColor = theme.success;
        break;
      case 'delayed':
        statusText = run.delayMinutes ? `Live · delayed ${run.delayMinutes}m` : 'Live · delayed';
        statusBg = theme.muted;
        statusColor = theme.arrival;
        break;
      case 'live_estimate':
        statusText = 'Live estimate';
        statusBg = theme.muted;
        statusColor = theme.primary;
        break;
      case 'unavailable':
        statusText = 'Tracking unavailable';
        statusBg = theme.muted;
        statusColor = theme.mutedForeground;
        break;
      case 'completed':
        statusText = 'Completed';
        statusBg = theme.muted;
        statusColor = theme.mutedForeground;
        break;
    }
  }

  const durationHrs = Math.floor(run.durationMinutes / 60);
  const durationMins = run.durationMinutes % 60;
  const durationText = durationHrs > 0 ? `${durationHrs} hr, ${durationMins} min trip` : `${durationMins} min trip`;

  const pickupStops = verifiedJourney?.stops.filter(s => s.kind === 'pickup') || [];
  const dropoffStops = verifiedJourney?.stops.filter(s => s.kind === 'dropoff') || [];

  return (
    <Surface variant="card" style={[styles.card, { borderColor: theme.border, borderRadius: 16, padding: 0 }]}>
      <View style={[styles.summary]}>
        <View style={[styles.topRow, rtl && styles.rtlRow]}>
          <View style={styles.topLeft}>
            <AppText allowFontScaling style={[styles.time, { color: theme.foreground, fontSize: 24 * scale }]}>
              {formatTime(run.scheduledTime)}{followingDayLabel(serviceDate, run.scheduledTime)}
            </AppText>
            {run.arrivalTime && (
              <AppText style={[styles.arrives, { color: theme.mutedForeground }]}>
                → {formatTime(run.arrivalTime)} Scheduled arrival
              </AppText>
            )}
            <AppText style={[styles.routeDescriptions, { color: theme.mutedForeground }]} numberOfLines={1}>
              {run.pickupDescription} • {run.dropoffDescription}
            </AppText>
          </View>

          <View style={styles.topRight}>
            <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
              <AppText style={[styles.statusText, { color: statusColor }]}>{statusText}</AppText>
            </View>
            <AppText style={[styles.duration, { color: theme.mutedForeground }]}>{durationText}</AppText>
            {offline || (stale && ['on_time', 'delayed', 'live_estimate'].includes(run.departureStatus))
              ? <AppText style={[styles.sourceNote, { color: theme.mutedForeground }]}>
                {offline ? 'Times may have changed' : 'Check for an update'}
              </AppText> : null}
          </View>
        </View>

        <View style={styles.bottomRow}>
          <View style={styles.badgesRow}>
            {meanings.map(item => (
              <View key={item.key} style={[styles.keyBadgeMini, { backgroundColor: theme.primary }]}>
                <AppText style={{ color: theme.primaryForeground, fontWeight: '800', fontSize: 13 }}>{item.key}</AppText>
              </View>
            ))}
          </View>

          <Pressable
            onPress={handlePress}
            style={({ pressed }) => [styles.toggleButton, { borderColor: theme.border }, pressed && { backgroundColor: theme.muted }]}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? 'Hide stops' : 'Stops & boarding'}
            testID={`expand-run-${run.id}`}
          >
            <AppText style={[styles.toggleButtonText, { color: theme.foreground }]}>
              {expanded ? 'Hide stops' : 'Stops & boarding'}
            </AppText>
            <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.foreground} />
          </Pressable>
        </View>
      </View>

      {expanded && (
        <View style={[styles.details, { borderTopColor: theme.border }]}>
          {verifiedJourney && pickupStops.length > 0 && dropoffStops.length > 0 ? (
            <>
              <View style={styles.routeBox}>
                <View style={styles.routeHeader}>
                  <Feather name="map-pin" size={14} color={theme.success} />
                  <AppText style={[styles.routeHeaderText, { color: theme.mutedForeground }]}>PICKUP ROUTE</AppText>
                </View>
                <View style={styles.timeline}>
                  {pickupStops.map((stop, i) => {
                    const isFirst = i === 0;
                    const isLast = i === pickupStops.length - 1;
                    return (
                      <View key={stop.id} style={styles.timelineItem}>
                        <View style={styles.timelineGraphics}>
                          <View style={[styles.timelineNode, { borderColor: theme.success, backgroundColor: i === 0 ? theme.success : (i === pickupStops.length - 1 ? theme.muted : 'transparent') }]}>
                            <AppText style={{ fontSize: 11, fontWeight: '700', color: i === 0 ? theme.card : theme.foreground }}>{i + 1}</AppText>
                          </View>
                          {!isLast && <View style={[styles.timelineLine, { borderColor: theme.success, borderStyle: 'dashed', borderLeftWidth: 1, borderRightWidth: 0, borderTopWidth: 0, borderBottomWidth: 0 }]} />}
                        </View>
                        <View style={styles.timelineContent}>
                          <AppText style={[styles.stopName, { color: theme.foreground }]}>{stop.label}</AppText>
                          {isFirst && <View style={[styles.stopTag, { backgroundColor: theme.muted }]}><AppText style={[styles.stopTagText, { color: theme.success }]}>FIRST</AppText></View>}
                          {isLast && <View style={[styles.stopTag, { backgroundColor: theme.muted }]}><AppText style={[styles.stopTagText, { color: theme.secondary }]}>LAST</AppText></View>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={styles.routeDivider}>
                <Feather name="arrow-down" size={20} color={theme.mutedForeground} />
              </View>

              <View style={styles.routeBox}>
                <View style={styles.routeHeader}>
                  <Feather name="map-pin" size={14} color={theme.arrival} />
                  <AppText style={[styles.routeHeaderText, { color: theme.mutedForeground }]}>DROP-OFF ROUTE</AppText>
                </View>
                <View style={styles.timeline}>
                  {dropoffStops.map((stop, i) => {
                    const isFirst = i === 0;
                    const isLast = i === dropoffStops.length - 1;
                    return (
                      <View key={stop.id} style={styles.timelineItem}>
                        <View style={styles.timelineGraphics}>
                          <View style={[styles.timelineNode, { borderColor: theme.arrival, backgroundColor: i === 0 ? theme.arrival : 'transparent' }]}>
                            <AppText style={{ fontSize: 11, fontWeight: '700', color: i === 0 ? theme.card : theme.foreground }}>{i + 1}</AppText>
                          </View>
                          {!isLast && <View style={[styles.timelineLine, { borderColor: theme.arrival, borderStyle: 'dashed', borderLeftWidth: 1, borderRightWidth: 0, borderTopWidth: 0, borderBottomWidth: 0 }]} />}
                        </View>
                        <View style={styles.timelineContent}>
                          <AppText style={[styles.stopName, { color: theme.foreground }]}>{stop.label}</AppText>
                          {isFirst && <View style={[styles.stopTag, { backgroundColor: theme.muted }]}><AppText style={[styles.stopTagText, { color: theme.arrival }]}>FIRST</AppText></View>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </>
          ) : (
            <View style={{ marginBottom: 16 }}>
              <AppText style={{ color: theme.mutedForeground, fontStyle: 'italic' }}>Exact verified stops are currently unavailable for this run.</AppText>
            </View>
          )}

          {meanings.length > 0 && (
            <View style={[styles.keysSection, { backgroundColor: theme.muted }]}>
              {meanings.map(item => (
                <View key={item.key} style={styles.keyRow}>
                  <View style={[styles.keyBadge, { backgroundColor: theme.primary }]}>
                    <AppText style={{ color: theme.primaryForeground, fontWeight: '800', fontSize: 12 }}>{item.key}</AppText>
                  </View>
                  <AppText style={[styles.keyMeaning, { color: theme.mutedForeground }]}>
                    {item.meaning ?? 'No published explanation is available.'}
                  </AppText>
                </View>
              ))}
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.choose, { backgroundColor: canSelect ? theme.secondary : theme.muted }, pressed && { opacity: 0.8 }]}
            onPress={handleSelect}
            disabled={!canSelect}
            accessibilityRole="button"
            accessibilityLabel={canSelect ? `Choose exact ${formatTime(run.scheduledTime)} run` : 'Choose exact pickup and drop-off above to view this trip'}
            accessibilityState={{ disabled: !canSelect }}
            testID={`choose-run-${run.id}`}
          >
            <AppText style={[styles.chooseText, { color: canSelect ? theme.secondaryForeground : theme.mutedForeground }]}>
              {canSelect ? 'View this trip' : 'Choose exact stops above to view'}
            </AppText>
            {canSelect && <Feather name={rtl ? 'arrow-left' : 'arrow-right'} size={18} color={theme.secondaryForeground} />}
          </Pressable>
        </View>
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 14, borderWidth: 1, overflow: 'hidden' },
  summary: { padding: 18, backgroundColor: 'transparent' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  rtlRow: { flexDirection: 'row-reverse' },
  topLeft: { flex: 1, paddingRight: 16 },
  time: { fontWeight: '800', letterSpacing: -0.5 },
  arrives: { fontSize: 15, fontWeight: '600', marginTop: 4, letterSpacing: -0.2 },
  routeDescriptions: { fontSize: 14, fontWeight: '500', marginTop: 4 },

  topRight: { alignItems: 'flex-end' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginBottom: 6 },
  statusText: { fontSize: 12, fontWeight: '700' },
  duration: { fontSize: 13, fontWeight: '500' },
  sourceNote: { fontSize: 11, textAlign: 'right', marginTop: 3, maxWidth: 118 },

  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  badgesRow: { flexDirection: 'row', gap: 6 },
  keyBadgeMini: { minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  
  toggleButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1 },
  toggleButtonText: { fontSize: 13, fontWeight: '700' },

  details: { borderTopWidth: 1, padding: 18 },
  routeBox: { borderRadius: 12, padding: 16, backgroundColor: 'transparent' },
  routeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  routeHeaderText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },

  timeline: { paddingLeft: 4 },
  timelineItem: { flexDirection: 'row', minHeight: 48 },
  timelineGraphics: { width: 32, alignItems: 'center' },
  timelineNode: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  timelineLine: { position: 'absolute', top: 24, bottom: -8, width: 0, borderWidth: 1 },

  timelineContent: { flex: 1, paddingBottom: 24, paddingLeft: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stopName: { fontSize: 15, fontWeight: '600' },
  stopTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12, alignSelf: 'flex-start' },
  stopTagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  routeDivider: { alignItems: 'center', paddingVertical: 12 },

  keysSection: { marginTop: 16, marginBottom: 8, padding: 12, borderRadius: 12 },
  keyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  keyBadge: { minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  keyMeaning: { flex: 1, fontSize: 13, lineHeight: 19 },
  
  choose: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  chooseText: { fontSize: 16, fontWeight: '800' },
});
