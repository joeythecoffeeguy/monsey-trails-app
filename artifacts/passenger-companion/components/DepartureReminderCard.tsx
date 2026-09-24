import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppText } from '@/components/AppText';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { DepartureReminder, DepartureReminderInput } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Surface } from './Surface';
import {
  DEFAULT_DEPARTURE_REMINDER_LEAD_MINUTES,
  DEPARTURE_REMINDER_LIMITATION,
  departureReminderApi,
  openDepartureNotificationSettings,
  prepareDepartureNotificationPermission,
  type DepartureReminderIntegrationProps,
} from '@/lib/departure-reminders';

const DAYS = [
  { value: 1, label: 'M' }, { value: 2, label: 'T' }, { value: 3, label: 'W' },
  { value: 4, label: 'T' }, { value: 5, label: 'F' }, { value: 6, label: 'S' },
  { value: 7, label: 'S' },
] as const;
const LEADS = [5, 15, 30, 60] as const;

function weekdayFor(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day || 7;
}

function nextLabel(value: string | null) {
  if (!value) return 'Checking the next published service';
  return new Date(value).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function DepartureReminderCard({ deviceId, selectedTrip, canSave = true }: DepartureReminderIntegrationProps & { canSave?: boolean }) {
  const theme = useColors();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [reminders, setReminders] = useState<DepartureReminder[]>([]);
  const [kind, setKind] = useState<'once' | 'weekly'>('once');
  const [weekdays, setWeekdays] = useState<number[]>([weekdayFor(selectedTrip.serviceDate)]);
  const [leadMinutes, setLeadMinutes] = useState(DEFAULT_DEPARTURE_REMINDER_LEAD_MINUTES);
  const [editing, setEditing] = useState<DepartureReminder | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const relevant = reminders.filter(item =>
    item.line === selectedTrip.line && item.origin === selectedTrip.origin
    && item.destination === selectedTrip.destination && item.runId === selectedTrip.runId
    && (item.kind === 'weekly' || item.serviceDate === selectedTrip.serviceDate)
    && item.state !== 'cancelled',
  );

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    try {
      setReminders((await departureReminderApi.list(deviceId)).reminders);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load reminders.');
    }
  }, [deviceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const beginEdit = (reminder: DepartureReminder) => {
    setEditing(reminder);
    setKind(reminder.kind);
    setWeekdays(reminder.weekdays.length ? reminder.weekdays : [weekdayFor(selectedTrip.serviceDate)]);
    setLeadMinutes(reminder.leadMinutes);
    setMessage('');
  };

  const toggleDay = (day: number) => {
    if (Platform.OS !== 'web') {
      import('expo-haptics').then(Haptics => Haptics.selectionAsync());
    }
    setWeekdays(current => current.includes(day)
      ? current.filter(value => value !== day)
      : [...current, day].sort((a, b) => a - b));
  };

  const save = async () => {
    if (!canSave) {
      setMessage('Choose your exact pickup and drop-off above before setting a reminder.');
      return;
    }
    if (kind === 'weekly' && !weekdays.length) {
      setMessage('Choose at least one weekday.');
      return;
    }
    setBusy(true);
    setMessage('');
    setShowSettings(false);
    try {
      const permission = await prepareDepartureNotificationPermission();
      if (permission.status !== 'granted') {
        setMessage(permission.message);
        setShowSettings(permission.status === 'denied' && permission.canOpenSettings);
        return;
      }
      const input: DepartureReminderInput = {
        deviceId,
        kind,
        serviceDate: selectedTrip.serviceDate,
        line: selectedTrip.line as 1 | 2 | 3,
        origin: selectedTrip.origin,
        destination: selectedTrip.destination,
        runId: selectedTrip.runId,
        ...(kind === 'weekly' ? { weekdays } : {}),
        leadMinutes,
        delivery: permission.delivery,
      };
      const response = editing
        ? await departureReminderApi.update(editing.id, input)
        : await departureReminderApi.create(input);
      setEditing(null);
      setMessage(editing ? 'Reminder updated.' : 'Departure reminder set.');
      setReminders(current => [
        response.reminder,
        ...current.filter(item => item.id !== response.reminder.id),
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the reminder.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (reminder: DepartureReminder) => {
    setBusy(true);
    setMessage('');
    try {
      await departureReminderApi.cancel(reminder.id);
      setReminders(current => current.filter(item => item.id !== reminder.id));
      if (editing?.id === reminder.id) setEditing(null);
      setMessage('Reminder cancelled.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel the reminder.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Surface variant="card" style={styles.card} accessibilityLabel="Departure reminders">
      <View style={styles.titleRow}>
        <View style={styles.icon}><Feather name="bell" size={18} color={theme.primaryForeground} /></View>
        <View style={styles.grow}>
          <AppText style={styles.title}>Departure reminder</AppText>
          <AppText style={styles.subtitle}>We’ll recheck the published schedule before alerting you.</AppText>
        </View>
      </View>

      {relevant.map(reminder => (
        <View key={reminder.id} style={styles.saved} testID="selected-run-departure-reminder">
          <View style={styles.grow}>
            <AppText style={styles.savedTitle}>{reminder.kind === 'once' ? 'One trip' : `Weekly · ${reminder.weekdays.map(day => DAYS[day - 1]?.label).join(' ')}`} · {reminder.leadMinutes} min before</AppText>
            <AppText style={styles.savedDetail}>{nextLabel(reminder.nextOccurrenceAt)}</AppText>
          </View>
          <Pressable onPress={() => beginEdit(reminder)} style={styles.smallButton} accessibilityLabel="Edit departure reminder">
            <Feather name="edit-2" size={15} color={theme.primary} />
          </Pressable>
          <Pressable onPress={() => void cancel(reminder)} disabled={busy} style={styles.smallButton} accessibilityLabel="Cancel departure reminder">
            <Feather name="trash-2" size={15} color={theme.destructive} />
          </Pressable>
        </View>
      ))}

      <View style={styles.segment}>
        {(['once', 'weekly'] as const).map(value => (
          <Pressable key={value} onPress={() => { if (Platform.OS !== 'web') { import('expo-haptics').then(H => H.selectionAsync()); } setKind(value); }} style={[styles.segmentButton, kind === value && styles.segmentSelected]} accessibilityRole="radio" accessibilityState={{ checked: kind === value }}>
            <AppText style={[styles.segmentText, kind === value && styles.segmentTextSelected]}>{value === 'once' ? 'This trip' : 'Selected weekdays'}</AppText>
          </Pressable>
        ))}
      </View>

      {kind === 'weekly' ? (
        <View style={styles.days}>
          {DAYS.map(day => (
            <Pressable key={day.value} onPress={() => toggleDay(day.value)} style={[styles.day, weekdays.includes(day.value) && styles.daySelected]} accessibilityRole="checkbox" accessibilityState={{ checked: weekdays.includes(day.value) }}>
              <AppText style={[styles.dayText, weekdays.includes(day.value) && styles.dayTextSelected]}>{day.label}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}

      <AppText style={styles.label}>Alert me before departure</AppText>
      <View style={styles.leads}>
        {LEADS.map(value => (
          <Pressable key={value} onPress={() => { if (Platform.OS !== 'web') { import('expo-haptics').then(H => H.selectionAsync()); } setLeadMinutes(value); }} style={[styles.lead, leadMinutes === value && styles.leadSelected]} accessibilityRole="radio" accessibilityState={{ checked: leadMinutes === value }}>
            <AppText style={[styles.leadText, leadMinutes === value && styles.leadTextSelected]}>{value < 60 ? `${value} min` : '1 hr'}</AppText>
          </Pressable>
        ))}
      </View>

      {!canSave ? <AppText style={styles.subtitle}>Choose your exact stops above before setting a reminder. Reminders follow the selected run’s departure, not a stop-specific arrival.</AppText> : null}
      <Pressable onPress={() => void save()} disabled={busy || !deviceId || !canSave}
        style={[styles.save, (busy || !deviceId || !canSave) && styles.disabled]}
        accessibilityRole="button" accessibilityState={{ disabled: busy || !deviceId || !canSave }}
        testID="save-departure-reminder">
        <AppText style={styles.saveText}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Set reminder'}</AppText>
      </Pressable>
      {editing ? <Pressable onPress={() => setEditing(null)} style={styles.cancelEdit}><AppText style={styles.cancelEditText}>Cancel editing</AppText></Pressable> : null}
      {message ? <AppText style={[styles.message, message.includes('denied') || message.includes('Could not') || message.includes('blocked') ? styles.error : null]} accessibilityRole="alert">{message}</AppText> : null}
      {showSettings ? <Pressable onPress={() => void openDepartureNotificationSettings()} style={styles.settings}><AppText style={styles.settingsText}>Open notification settings</AppText></Pressable> : null}
      <AppText style={styles.policy}>{relevant[0]?.policy ?? 'Weekly reminders only fire when this trip is actually published. Changed times replace old times; removed trips send a cancellation. A rare duplicate is possible if the server crashes after push acceptance; stable notification tags help collapse duplicates.'}</AppText>
      <AppText style={styles.limitation}>{DEPARTURE_REMINDER_LIMITATION}</AppText>
    </Surface>
  );
}

const createStyles = (theme: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { padding: 16, marginBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary },
  grow: { flex: 1 },
  title: { color: theme.foreground, fontWeight: '800', fontSize: 18 },
  subtitle: { color: theme.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 2 },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: theme.background, padding: 10, marginTop: 12 },
  savedTitle: { color: theme.foreground, fontWeight: '700', fontSize: 13 },
  savedDetail: { color: theme.mutedForeground, fontSize: 11, marginTop: 2 },
  smallButton: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', backgroundColor: theme.background, padding: 3, borderRadius: 12, marginTop: 14 },
  segmentButton: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  segmentSelected: { backgroundColor: theme.primary },
  segmentText: { color: theme.mutedForeground, fontWeight: '700', fontSize: 12 },
  segmentTextSelected: { color: theme.primaryForeground },
  days: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  day: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  daySelected: { backgroundColor: theme.primary, borderColor: theme.primary },
  dayText: { color: theme.foreground, fontWeight: '700' },
  dayTextSelected: { color: theme.primaryForeground },
  label: { color: theme.foreground, fontSize: 12, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  leads: { flexDirection: 'row', gap: 6 },
  lead: { flex: 1, minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  leadSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
  leadText: { color: theme.foreground, fontSize: 12, fontWeight: '700' },
  leadTextSelected: { color: theme.primaryForeground },
  save: { minHeight: 46, borderRadius: 12, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  saveText: { color: theme.primaryForeground, fontWeight: '800', fontSize: 14 },
  disabled: { opacity: 0.55 },
  cancelEdit: { alignItems: 'center', paddingTop: 10 },
  cancelEditText: { color: theme.mutedForeground, fontWeight: '700', fontSize: 12 },
  message: { color: theme.success, fontWeight: '700', fontSize: 12, marginTop: 10 },
  error: { color: theme.destructive },
  settings: { alignSelf: 'flex-start', marginTop: 8, borderBottomWidth: 1, borderColor: theme.primary },
  settingsText: { color: theme.primary, fontWeight: '800', fontSize: 12 },
  policy: { color: theme.mutedForeground, fontSize: 11, lineHeight: 16, marginTop: 12 },
  limitation: { color: theme.mutedForeground, fontSize: 10, lineHeight: 15, marginTop: 5 },
});