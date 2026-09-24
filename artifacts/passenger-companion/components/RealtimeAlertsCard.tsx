import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Surface } from '@/components/Surface';
import { useColors } from '@/hooks/useColors';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import type {
  PassengerRealtimeSubscription,
  PassengerRealtimeSubscriptionInputFlow,
} from '@workspace/api-client-react';
import {
  buildRealtimeSubscriptionInput,
  canSubscribeToActivePairedRun,
  findRealtimeSubscription,
  openRealtimeNotificationSettings,
  passengerRealtimeAlertApi,
  prepareRealtimeNotificationPermission,
  type RealtimeAlertIdentity,
  type RealtimeAlertsCardProps,
  type RealtimeTransferOption,
} from '@/lib/realtime-alerts';

const words = {
  en: {
    title: 'Trip alerts',
    subtitle: 'Choose the updates you want for this paired run.',
    disruption: 'Run disruptions',
    disruptionHelp: 'Service changes for this exact run',
    pickup: 'Approaching pickup',
    pickupHelp: 'A notification as the coach nears your pickup',
    transfer: 'Connection risk',
    transferHelp: 'A warning if a selected connection becomes difficult',
    sound: 'Play notification sound',
    enable: 'Turn on',
    disable: 'Turn off',
    active: 'On for this run',
    unavailable: 'Pair and select an active passenger run to manage realtime alerts.',
    noPickup: 'Choose a verified pickup stop before enabling pickup alerts.',
    noTransfer: 'Search and explicitly select a published onward run before enabling a connection alert.',
    chooseTransfer: 'Select an onward run',
    refresh: 'Refresh alert status',
    loading: 'Checking saved alerts…',
    settings: 'Open notification settings',
    transferStatus: 'Connection status',
  },
  yi: {
    title: 'רייזע מעלדונגען',
    subtitle: 'קלייבט אויס וועלכע מעלדונגען איר ווילט פאר דער פארבונדענער נסיעה.',
    disruption: 'רייזע ענדערונגען',
    disruptionHelp: 'סערוויס ענדערונגען פאר דער גענויער נסיעה',
    pickup: 'דערנענטערנדיק זיך צום אויפנעם',
    pickupHelp: 'א מעלדונג ווען דער אויטאבוס דערנענטערט זיך',
    transfer: 'פארבינדונג ריזיקע',
    transferHelp: 'א ווארענונג אויב די אויסגעקליבענע פארבינדונג ווערט שווער',
    sound: 'שפילן א מעלדונג קלאנג',
    enable: 'אנצינדן',
    disable: 'אויסלעשן',
    active: 'אנגעצונדן פאר דער נסיעה',
    unavailable: 'פארבינדט און קלייבט אן אקטיווע נסיעה צו פירן מעלדונגען.',
    noPickup: 'קלייבט א באשטעטיגטן אויפנעם-פונקט.',
    noTransfer: 'זוכט און קלייבט בפירוש א פארעפנטלעכטן ווייטערדיקן אויטאבוס.',
    chooseTransfer: 'קלייבט א ווייטערדיקע נסיעה',
    refresh: 'דערפרישן מעלדונגען',
    loading: 'קוקט נאך געראטעוועטע מעלדונגען…',
    settings: 'עפענען מעלדונג סעטינגס',
    transferStatus: 'פארבינדונג סטאטוס',
  },
  he: {
    title: 'התראות לנסיעה',
    subtitle: 'בחרו אילו עדכונים לקבל עבור הנסיעה המשויכת.',
    disruption: 'שיבושים בנסיעה',
    disruptionHelp: 'שינויים בשירות עבור הנסיעה המדויקת',
    pickup: 'התקרבות לאיסוף',
    pickupHelp: 'התראה כשהאוטובוס מתקרב לנקודת האיסוף',
    transfer: 'סיכון בחיבור',
    transferHelp: 'אזהרה אם החיבור שנבחר נעשה קשה',
    sound: 'השמעת צליל בהתראה',
    enable: 'הפעלה',
    disable: 'כיבוי',
    active: 'פעיל לנסיעה הזו',
    unavailable: 'יש לשייך ולבחור נסיעה פעילה כדי לנהל התראות.',
    noPickup: 'בחרו נקודת איסוף מאומתת לפני הפעלת ההתראה.',
    noTransfer: 'חפשו ובחרו במפורש נסיעת המשך שפורסמה.',
    chooseTransfer: 'בחירת נסיעת המשך',
    refresh: 'רענון מצב ההתראות',
    loading: 'בודק התראות שמורות…',
    settings: 'פתיחת הגדרות ההתראות',
    transferStatus: 'מצב החיבור',
  },
} as const;

type AlertRowProps = {
  flow: PassengerRealtimeSubscriptionInputFlow;
  title: string;
  description: string;
  active: boolean;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
  labels: { enable: string; disable: string; active: string };
  styles: ReturnType<typeof createStyles>;
  theme: ReturnType<typeof useColors>;
  status?: string;
};

function AlertRow({
  flow, title, description, active, busy, disabled, onPress, labels, styles, theme, status,
}: AlertRowProps) {
  return (
    <View style={styles.row} testID={`realtime-alert-${flow}`}>
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Feather
            name={active ? 'check-circle' : 'bell'}
            size={17}
            color={active ? theme.success : theme.primary}
          />
          <AppText style={styles.rowTitle}>{title}</AppText>
        </View>
        <AppText style={styles.rowDescription}>{active ? labels.active : description}</AppText>
        {status ? <AppText style={styles.status}>{status}</AppText> : null}
      </View>
      <Pressable
        onPress={onPress}
        disabled={busy || disabled}
        style={[styles.action, (busy || disabled) && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={`${active ? labels.disable : labels.enable} ${title}`}
        accessibilityState={{ disabled: busy || !!disabled }}
        testID={`toggle-realtime-alert-${flow}`}
      >
        {busy
          ? <ActivityIndicator size="small" color={theme.primaryForeground} />
          : <AppText style={styles.actionText}>{active ? labels.disable : labels.enable}</AppText>}
      </Pressable>
    </View>
  );
}

export function RealtimeAlertsCard({
  passengerCode,
  deviceId,
  runKey,
  pickupStopId,
  transferOptions = [],
  language = 'en',
}: RealtimeAlertsCardProps) {
  const theme = useColors();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const labels = words[language];
  const rtl = language !== 'en';
  const identity: RealtimeAlertIdentity = { passengerCode, deviceId, runKey, pickupStopId };
  const eligible = canSubscribeToActivePairedRun(identity);
  const [subscriptions, setSubscriptions] = useState<PassengerRealtimeSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingFlow, setPendingFlow] = useState<PassengerRealtimeSubscriptionInputFlow | null>(null);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedTransferKey, setSelectedTransferKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!eligible) {
      setSubscriptions([]);
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const result = await passengerRealtimeAlertApi.list(deviceId);
      setSubscriptions(result.subscriptions);
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : 'Could not load saved realtime alerts.');
    } finally {
      setLoading(false);
    }
  }, [deviceId, eligible]);

  useEffect(() => {
    let current = true;
    if (!eligible) {
      setSubscriptions([]);
      setLoading(false);
      return () => { current = false; };
    }
    setLoading(true);
    setMessage('');
    void passengerRealtimeAlertApi.list(deviceId).then(result => {
      if (current) setSubscriptions(result.subscriptions);
    }).catch(error => {
      if (current) {
        setIsError(true);
        setMessage(error instanceof Error ? error.message : 'Could not load saved realtime alerts.');
      }
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [deviceId, eligible, runKey]);

  const disruption = findRealtimeSubscription(subscriptions, runKey, 'disruption');
  const pickup = findRealtimeSubscription(subscriptions, runKey, 'approaching-pickup', pickupStopId)
    ?? subscriptions.find(item => item.active
      && item.officialRunKey === runKey
      && item.flow === 'approaching-pickup');
  const selectedTransfer = transferOptions.find(option => optionKey(option) === selectedTransferKey);
  const savedTransferOption = transferOptions.find(option =>
    findRealtimeSubscription(subscriptions, runKey, 'transfer-risk', undefined, option),
  );
  const transferChoice = selectedTransfer ?? savedTransferOption;
  const transfer = transferChoice
    ? findRealtimeSubscription(subscriptions, runKey, 'transfer-risk', undefined, transferChoice)
    : undefined;
  const activeTransfer = transfer ?? subscriptions.find(item =>
    item.active && item.flow === 'transfer-risk' && item.officialRunKey === runKey,
  );

  const toggleFlow = async (
    flow: PassengerRealtimeSubscriptionInputFlow,
    existing: PassengerRealtimeSubscription | undefined,
    option?: RealtimeTransferOption,
  ) => {
    if (!eligible) {
      setIsError(true);
      setMessage(labels.unavailable);
      return;
    }
    setPendingFlow(flow);
    setMessage('');
    setIsError(false);
    setShowSettings(false);
    try {
      if (existing) {
        await passengerRealtimeAlertApi.cancel(existing.id);
        setSubscriptions(current => current.filter(item => item.id !== existing.id));
        setMessage('Alert cancelled.');
        return;
      }

      const permission = await prepareRealtimeNotificationPermission();
      if (permission.status !== 'granted') {
        setIsError(true);
        setMessage(permission.message);
        setShowSettings(permission.status === 'denied' && permission.canOpenSettings);
        return;
      }
      const input = buildRealtimeSubscriptionInput(identity, flow, permission.expoPushToken, soundEnabled, option);
      const prior = flow === 'disruption' ? disruption
        : flow === 'approaching-pickup' ? pickup : transfer;
      const response = prior
        ? await passengerRealtimeAlertApi.update(prior.id, input)
        : await passengerRealtimeAlertApi.create(input);
      setSubscriptions(current => [
        response.subscription,
        ...current.filter(item => item.id !== response.subscription.id),
      ]);
      setMessage(prior ? 'Alert settings updated.' : 'Alert enabled for this run.');
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : 'Could not update realtime alerts.');
    } finally {
      setPendingFlow(null);
    }
  };

  const selectTransfer = (option: RealtimeTransferOption) => {
    if (Platform.OS !== 'web') import('expo-haptics').then(Haptics => Haptics.selectionAsync());
    setSelectedTransferKey(optionKey(option));
    setMessage('');
  };

  return (
    <Surface variant="card" style={styles.card} accessibilityLabel={labels.title}>
      <View style={[styles.header, rtl && styles.rtl]}>
        <View style={styles.icon}>
          <Feather name="radio" size={17} color={theme.primaryForeground} />
        </View>
        <View style={styles.headerCopy}>
          <AppText style={[styles.title, rtl && styles.textRtl]}>{labels.title}</AppText>
          <AppText style={[styles.subtitle, rtl && styles.textRtl]}>{labels.subtitle}</AppText>
        </View>
        {eligible ? (
          <Pressable
            onPress={() => void refresh()}
            disabled={loading || pendingFlow !== null}
            style={styles.refresh}
            accessibilityRole="button"
            accessibilityLabel={labels.refresh}
            testID="refresh-realtime-alerts"
          >
            <Feather name="refresh-cw" size={16} color={theme.primary} />
          </Pressable>
        ) : null}
      </View>

      {!eligible ? (
        <AppText style={styles.notice} accessibilityRole="alert">{labels.unavailable}</AppText>
      ) : (
        <>
          {loading && subscriptions.length === 0 ? (
            <View style={styles.loading}><ActivityIndicator size="small" color={theme.primary} /><AppText style={styles.notice}>{labels.loading}</AppText></View>
          ) : null}

          <AlertRow
            flow="disruption"
            title={labels.disruption}
            description={labels.disruptionHelp}
            active={!!disruption}
            busy={pendingFlow === 'disruption'}
            onPress={() => void toggleFlow('disruption', disruption)}
            labels={labels}
            styles={styles}
            theme={theme}
          />
          <AlertRow
            flow="approaching-pickup"
            title={labels.pickup}
            description={labels.pickupHelp}
            active={!!pickup}
            busy={pendingFlow === 'approaching-pickup'}
            disabled={!pickup && !pickupStopId}
            onPress={() => void toggleFlow('approaching-pickup', pickup)}
            labels={labels}
            styles={styles}
            theme={theme}
          />
          {!pickupStopId ? <AppText style={styles.helper}>{labels.noPickup}</AppText> : null}

          <View style={styles.transferHeading}>
            <AppText style={[styles.sectionTitle, rtl && styles.textRtl]}>{labels.transfer}</AppText>
            <AppText style={[styles.helper, rtl && styles.textRtl]}>{labels.transferHelp}</AppText>
          </View>
          {transferOptions.length ? transferOptions.map(option => {
            const chosen = optionKey(option) === (selectedTransferKey ?? (savedTransferOption ? optionKey(savedTransferOption) : null));
            return (
              <Pressable
                key={optionKey(option)}
                onPress={() => selectTransfer(option)}
                style={[styles.transferOption, chosen && styles.transferChosen]}
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen }}
                accessibilityLabel={`${option.origin.name} to ${option.destination.name}, ${option.bufferMinutes} minutes`}
                testID={`select-transfer-${option.onwardRunKey}`}
              >
                <View style={styles.radio}>{chosen ? <View style={styles.radioDot} /> : null}</View>
                <View style={styles.transferCopy}>
                  <AppText style={styles.transferRoute}>{option.origin.name} → {option.destination.name}</AppText>
                  <AppText style={styles.transferDetail}>
                    {option.sharedStop.label} · {option.bufferMinutes} min · {option.connectionStatus.replace('_', ' ')}
                  </AppText>
                </View>
              </Pressable>
            );
          }) : (
            <AppText style={styles.helper}>{labels.noTransfer}</AppText>
          )}
          {transferChoice || activeTransfer ? (
            <AlertRow
              flow="transfer-risk"
              title={labels.transfer}
              description={transferChoice && (!activeTransfer || transfer)
                ? `${labels.transferHelp} · ${transferChoice.sharedStop.label}`
                : labels.active}
              active={!!activeTransfer}
              busy={pendingFlow === 'transfer-risk'}
              onPress={() => void toggleFlow('transfer-risk', activeTransfer, transferChoice)}
              labels={labels}
              styles={styles}
              theme={theme}
              status={activeTransfer?.lastConnectionStatus
                ? `${labels.transferStatus}: ${activeTransfer.lastConnectionStatus.replace('_', ' ')}`
                : undefined}
            />
          ) : null}

          <Pressable
            onPress={() => setSoundEnabled(current => !current)}
            style={[styles.soundRow, rtl && styles.rtl]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: soundEnabled }}
            testID="toggle-realtime-alert-sound"
          >
            <Feather name={soundEnabled ? 'volume-2' : 'volume-x'} size={16} color={theme.mutedForeground} />
            <AppText style={[styles.soundText, rtl && styles.textRtl]}>{labels.sound}</AppText>
            <View style={[styles.check, soundEnabled && styles.checked]}>{soundEnabled ? <Feather name="check" size={12} color={theme.primaryForeground} /> : null}</View>
          </Pressable>
          {message ? <AppText style={[styles.message, isError && styles.error]} accessibilityRole="alert">{message}</AppText> : null}
          {showSettings ? (
            <Pressable
              onPress={() => void openRealtimeNotificationSettings().catch(error => {
                setIsError(true);
                setMessage(error instanceof Error ? error.message : 'Could not open notification settings.');
              })}
              style={styles.settings}
            >
              <AppText style={styles.settingsText}>{labels.settings}</AppText>
            </Pressable>
          ) : null}
        </>
      )}
    </Surface>
  );
}

function optionKey(option: RealtimeTransferOption) {
  return `${option.onwardRunKey}|${option.incomingSharedStopId}|${option.areaId}|${option.minimumBufferMinutes}`;
}

const createStyles = (theme: ReturnType<typeof useColors>) => StyleSheet.create({
  card: { padding: 16, marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 8 },
  rtl: { flexDirection: 'row-reverse' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary },
  headerCopy: { flex: 1 },
  title: { color: theme.foreground, fontWeight: '800', fontSize: 17 },
  subtitle: { color: theme.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 2 },
  textRtl: { textAlign: 'right', writingDirection: 'rtl' },
  refresh: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  rowCopy: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowTitle: { color: theme.foreground, fontSize: 14, fontWeight: '700' },
  rowDescription: { color: theme.mutedForeground, fontSize: 11, lineHeight: 15, marginTop: 3 },
  status: { color: theme.arrival, fontSize: 11, fontWeight: '700', marginTop: 4 },
  action: { minWidth: 76, height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: theme.primary },
  actionText: { color: theme.primaryForeground, fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  transferHeading: { marginTop: 13, marginBottom: 7 },
  sectionTitle: { color: theme.foreground, fontSize: 14, fontWeight: '800' },
  helper: { color: theme.mutedForeground, fontSize: 11, lineHeight: 15, marginTop: 4, marginBottom: 6 },
  transferOption: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 11, marginTop: 7 },
  transferChosen: { borderColor: theme.primary, backgroundColor: theme.background },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: theme.mutedForeground, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.primary },
  transferCopy: { flex: 1 },
  transferRoute: { color: theme.foreground, fontSize: 13, fontWeight: '700' },
  transferDetail: { color: theme.mutedForeground, fontSize: 11, marginTop: 3 },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, marginTop: 4 },
  soundText: { flex: 1, color: theme.foreground, fontSize: 12, fontWeight: '600' },
  check: { width: 19, height: 19, borderRadius: 5, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: theme.primary, borderColor: theme.primary },
  notice: { color: theme.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 8 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  message: { color: theme.success, fontSize: 12, fontWeight: '700', marginTop: 7 },
  error: { color: theme.destructive },
  settings: { alignSelf: 'flex-start', borderBottomWidth: 1, borderColor: theme.primary, marginTop: 9 },
  settingsText: { color: theme.primary, fontSize: 12, fontWeight: '800' },
});