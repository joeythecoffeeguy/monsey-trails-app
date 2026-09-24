import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { Surface } from '@/components/Surface';
import { useColors } from '@/hooks/useColors';
import { isRtlLanguage, passengerCopy } from '@/lib/passenger-i18n';
import type { PassengerLanguage } from '@/lib/companion-preferences';

export type TripAnnouncement = {
  id: string;
  title: string;
  message: string;
  active: boolean;
};

export type VerifiedTripInformation = {
  /** Staff-authored content from the passenger-info API. */
  destinations?: TripInformationCard[];
  fares?: TripInformationCard[];
  guide?: TripInformationCard[];
  contact?: TripInformationCard[];
  /** Supply these only when sourced from a current, verified API record. */
  amenities?: TripInformationCard[];
  safety?: TripInformationCard[];
};

export type TripInformationCard = { title: string; text: string };

export type SelectedPassengerTrip = {
  /** The values are intentionally kept compatible with the public trip response. */
  runId?: string;
  origin?: string;
  destination?: string;
  serviceDate?: string;
  announcements?: TripAnnouncement[];
};

export type TripInformationProps = {
  selectedTrip?: SelectedPassengerTrip | null;
  language?: PassengerLanguage;
  /** Optional content is useful for API responses that already include verified sections. */
  verifiedInformation?: VerifiedTripInformation;
  /** Override for tests or an app that already has the API base URL. */
  informationUrl?: string;
};

type PassengerInfoResponse = {
  content?: Partial<Record<PassengerLanguage, Partial<VerifiedTripInformation>>>;
  reviewedAt?: string;
  stale?: boolean;
};

type Section = 'announcements' | 'amenities' | 'safety';

const sectionLabels: Record<Section, { icon: keyof typeof Feather.glyphMap }> = {
  announcements: { icon: 'volume-2' },
  amenities: { icon: 'battery-charging' },
  safety: { icon: 'shield' },
};

function defaultInformationUrl() {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}/api/passenger-info` : null;
}

/**
 * Coach-only information for a selected trip. Service destinations and fares
 * are available separately, never under coach announcements.
 */
export function TripInformation({
  selectedTrip,
  language = 'en',
  verifiedInformation,
  informationUrl,
}: TripInformationProps) {
  const theme = useColors();
  const rtl = isRtlLanguage(language);
  const [section, setSection] = useState<Section>('announcements');
  const [remote, setRemote] = useState<PassengerInfoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (verifiedInformation || informationUrl === null) return;
    const url = informationUrl ?? defaultInformationUrl();
    if (!url) {
      setFailed(true);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void fetch(url, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Passenger information request failed (${response.status})`);
        return response.json() as Promise<PassengerInfoResponse>;
      })
      .then(value => setRemote(value))
      .catch(error => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setFailed(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [informationUrl, verifiedInformation]);

  const announcements = useMemo(
    () => (selectedTrip?.announcements ?? []).filter(item => item.active),
    [selectedTrip?.announcements],
  );
  const apiInformation = remote?.content?.[language] ?? {};
  const information = verifiedInformation ?? apiInformation;
  const candidateCards = section === 'announcements' ? [] : (information[section] ?? []);
  const cards = Array.isArray(candidateCards)
    ? candidateCards.filter(card => card && typeof card.title === 'string' && typeof card.text === 'string')
    : [];
  let content: React.ReactNode;
  if (section === 'announcements') {
    content = announcements.length
      ? announcements.map(item => (
        <View key={item.id} style={[styles.announcement, { backgroundColor: theme.accent }]} accessibilityLabel={`${item.title}. ${item.message}`}>
          <AppText style={[styles.cardTitle, { color: theme.foreground }]}>{item.title}</AppText>
          <AppText style={[styles.cardText, { color: theme.cardForeground }]}>{item.message}</AppText>
        </View>
      ))
      : <Unavailable text="No active announcements are available for this trip." theme={theme} />;
  } else if (loading) {
    content = <View style={styles.center}><ActivityIndicator color={theme.primary} accessibilityLabel="Loading passenger information" /></View>;
  } else if (failed && !verifiedInformation) {
    content = <Unavailable text="Passenger information is temporarily unavailable." theme={theme} />;
  } else {
    content = cards.length
      ? cards.map(card => (
        <View key={`${card.title}-${card.text}`} style={[styles.card, { borderColor: theme.border }]}>
          <AppText style={[styles.cardTitle, { color: theme.foreground }]}>{card.title}</AppText>
          <AppText style={[styles.cardText, { color: theme.cardForeground }]}>{card.text}</AppText>
        </View>
      ))
      : <Unavailable text="Verified information is not available for this section." theme={theme} />;
  }

  return (
    <Surface variant="card" style={[styles.container, { borderColor: theme.border }]} accessibilityLabel={passengerCopy(language, 'announcements')}>
      <View style={[styles.heading, rtl && styles.rtlRow]}>
        <View style={[styles.titleRow, rtl && styles.rtlRow]}>
          <Feather name="info" size={20} color={theme.primary} />
          <AppText style={[styles.title, { color: theme.foreground }]}>{passengerCopy(language, 'announcements')}</AppText>
        </View>
        {remote?.stale ? <AppText style={[styles.stale, { color: theme.arrival }]}>Review overdue</AppText> : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.tabs, rtl && styles.rtlRow]}
         accessibilityLabel={passengerCopy(language, 'announcements')}
      >
        {(Object.keys(sectionLabels) as Section[]).map(key => (
          <Pressable
            key={key}
            onPress={() => setSection(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: section === key }}
             accessibilityLabel={passengerCopy(language, key === 'announcements' ? 'tripUpdates' : key === 'safety' ? 'busSafety' : 'amenities')}
            style={[styles.tab, { borderColor: theme.border }, section === key && { backgroundColor: theme.primary, borderColor: theme.primary }]}
          >
            <Feather name={sectionLabels[key].icon} size={15} color={section === key ? theme.primaryForeground : theme.mutedForeground} />
             <AppText style={[styles.tabText, { color: section === key ? theme.primaryForeground : theme.mutedForeground }]}>
               {passengerCopy(language, key === 'announcements' ? 'tripUpdates' : key === 'safety' ? 'busSafety' : 'amenities')}
             </AppText>
          </Pressable>
        ))}
      </ScrollView>
      {content}
      {remote?.reviewedAt ? <AppText style={[styles.reviewed, { color: theme.mutedForeground }]}>Reviewed {new Date(remote.reviewedAt).toLocaleDateString()}</AppText> : null}
    </Surface>
  );
}

function Unavailable({ text, theme }: { text: string; theme: ReturnType<typeof useColors> }) {
  return <AppText style={[styles.unavailable, { color: theme.mutedForeground }]} accessibilityRole="text">{text}</AppText>;
}

const styles = StyleSheet.create({
  container: { marginTop: 16, padding: 16 },
  heading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  rtlRow: { flexDirection: 'row-reverse' },
  title: { fontSize: 19, fontWeight: '700' },
  stale: { fontSize: 12, fontWeight: '600' },
  tabs: { gap: 8, paddingBottom: 12 },
  tab: { alignItems: 'center', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 5, paddingHorizontal: 12, paddingVertical: 9 },
  tabText: { fontSize: 12, fontWeight: '600' },
  announcement: { borderRadius: 12, marginBottom: 10, padding: 13 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 10, padding: 13 },
  cardTitle: { fontSize: 15, fontWeight: '700', marginBottom: 5 },
  cardText: { fontSize: 14, lineHeight: 21 },
  unavailable: { fontSize: 14, lineHeight: 21, paddingVertical: 18, textAlign: 'center' },
  center: { alignItems: 'center', minHeight: 58, justifyContent: 'center' },
  reviewed: { fontSize: 11, marginTop: 2 },
});