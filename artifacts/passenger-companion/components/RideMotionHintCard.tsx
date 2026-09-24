import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { useColors } from '@/hooks/useColors';
import { assessRideMotion, type MotionSample } from '@/lib/ride-motion-hint';
import { Surface } from './Surface';

export type RideMotionHintCardProps = {
  /** Called only after the rider explicitly confirms the hint themselves. */
  onConfirmOnCoach?: () => void;
};

export function RideMotionHintCard({ onConfirmOnCoach }: RideMotionHintCardProps) {
  const theme = useColors();
  const styles = createStyles(theme);
  const [monitoring, setMonitoring] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hintAvailable, setHintAvailable] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);
  const samplesRef = useRef<MotionSample[]>([]);
  const mountedRef = useRef(true);

  const stopSampling = () => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    samplesRef.current = [];
    if (mountedRef.current) setMonitoring(false);
  };

  useEffect(() => {
    mountedRef.current = true;
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && subscriptionRef.current) {
        stopSampling();
        setMessage('Motion sensing stopped when the app left the foreground. Start again if you still want a hint.');
      }
    });
    return () => {
      mountedRef.current = false;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      appStateSubscription.remove();
    };
  }, []);

  const startSampling = async () => {
    if (Platform.OS === 'web') {
      setMessage('Motion hints are not available on web. Check your trip and confirm coach boarding yourself.');
      return;
    }
    setStarting(true);
    setMessage('');
    setHintAvailable(false);
    setConfirmed(false);
    samplesRef.current = [];
    try {
      // Accelerometer access on iOS and Android does not require a runtime
      // permission. Import only after the user opts in; web never loads it.
      const { Accelerometer } = await import('expo-sensors');
      const available = await Accelerometer.isAvailableAsync();
      if (!mountedRef.current) return;
      if (!available) {
        setMessage('This device does not provide an accelerometer. Check your trip and confirm boarding yourself.');
        return;
      }
      Accelerometer.setUpdateInterval(500);
      subscriptionRef.current = Accelerometer.addListener(reading => {
        if (!mountedRef.current) return;
        const now = Date.now();
        const samples = samplesRef.current;
        samples.push({ x: reading.x, y: reading.y, z: reading.z, timestampMs: now });
        samplesRef.current = samples.filter(sample => now - sample.timestampMs <= 20_000);
        const assessment = assessRideMotion(samplesRef.current, now);
        if (assessment.movementDetected) {
          subscriptionRef.current?.remove();
          subscriptionRef.current = null;
          setMonitoring(false);
          setHintAvailable(true);
          setMessage('');
        }
      });
      setMonitoring(true);
    } catch {
      if (mountedRef.current) {
        setMessage('Motion sensing could not start. You can still check your trip and confirm boarding yourself.');
      }
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  };

  const confirmManually = () => {
    setConfirmed(true);
    onConfirmOnCoach?.();
  };

  return (
    <Surface variant="card" style={styles.card} accessibilityLabel="Optional motion-based ride hint">
      <View style={styles.titleRow}>
        <View style={styles.icon}>
          <Feather name="activity" size={17} color={theme.primaryForeground} />
        </View>
        <View style={styles.grow}>
          <AppText style={styles.title}>Optional ride hint</AppText>
          <AppText style={styles.subtitle}>Your phone can notice sustained movement while this app is open.</AppText>
        </View>
      </View>

      {hintAvailable ? (
        <View style={styles.hint} testID="ride-motion-hint">
          <AppText style={styles.hintTitle}>Your phone sensed sustained movement</AppText>
          <AppText style={styles.body}>
            Movement can come from walking, handling your phone, or any vehicle. It does not prove you boarded this coach.
          </AppText>
          {confirmed ? (
            <AppText style={styles.confirmed} accessibilityLiveRegion="polite">You confirmed manually. Thanks for checking.</AppText>
          ) : (
            <Pressable onPress={confirmManually} style={styles.confirmButton} accessibilityRole="button" testID="confirm-coach-boarding">
              <Feather name="check" size={16} color={theme.primaryForeground} />
              <AppText style={styles.confirmButtonText}>I’m on my coach</AppText>
            </Pressable>
          )}
        </View>
      ) : (
        <AppText style={styles.body}>
          {monitoring
            ? 'Looking for sustained movement. This is only a hint—not proof of boarding. You can stop sensing at any time.'
            : 'Motion is off until you choose Start. This feature does not use location, save or send motion data, or run in the background. You must confirm boarding yourself.'}
        </AppText>
      )}

      {Platform.OS === 'web' ? (
        <View style={styles.webNote}>
          <Feather name="info" size={15} color={theme.mutedForeground} />
          <AppText style={styles.webNoteText}>Motion sensing is unavailable here. Please check your trip and confirm boarding yourself.</AppText>
        </View>
      ) : (
        <Pressable
          onPress={monitoring ? stopSampling : () => void startSampling()}
          disabled={starting}
          style={[styles.toggle, monitoring && styles.stopButton, starting && styles.disabled]}
          accessibilityRole="button"
          accessibilityState={{ disabled: starting }}
          testID={monitoring ? 'stop-ride-motion-hint' : 'start-ride-motion-hint'}
        >
          <Feather name={monitoring ? 'square' : 'play'} size={15} color={monitoring ? theme.foreground : theme.primaryForeground} />
          <AppText style={[styles.toggleText, monitoring && styles.stopText]}>
            {starting ? 'Starting…' : monitoring ? 'Stop motion sensing' : 'Start motion sensing'}
          </AppText>
        </Pressable>
      )}

      {message ? <AppText style={styles.message} accessibilityRole="alert">{message}</AppText> : null}
      <AppText style={styles.privacy}>
        Uses the accelerometer only while you opt in and stay in the foreground. No motion permission is requested on iOS or Android. No background sensing, location collection, or server storage.
      </AppText>
    </Surface>
  );
}

const createStyles = (theme: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { padding: 16, marginBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 10 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary },
  grow: { flex: 1 },
  title: { color: theme.foreground, fontWeight: '800', fontSize: 17 },
  subtitle: { color: theme.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 2 },
  body: { color: theme.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 4 },
  hint: { borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 12, marginTop: 4 },
  hintTitle: { color: theme.foreground, fontWeight: '800', fontSize: 14 },
  confirmButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 11, backgroundColor: theme.primary, marginTop: 12 },
  confirmButtonText: { color: theme.primaryForeground, fontWeight: '800', fontSize: 13 },
  confirmed: { color: theme.success, fontWeight: '700', fontSize: 12, marginTop: 10 },
  toggle: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 11, backgroundColor: theme.primary, marginTop: 12 },
  toggleText: { color: theme.primaryForeground, fontWeight: '800', fontSize: 13 },
  stopButton: { backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border },
  stopText: { color: theme.foreground },
  disabled: { opacity: 0.55 },
  webNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 12 },
  webNoteText: { flex: 1, color: theme.mutedForeground, fontSize: 12, lineHeight: 17 },
  message: { color: theme.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 10 },
  privacy: { color: theme.mutedForeground, fontSize: 10, lineHeight: 15, marginTop: 12 },
});