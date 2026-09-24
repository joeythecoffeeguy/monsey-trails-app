import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useGetPassengerInfo, getGetPassengerInfoQueryKey, type PassengerInfoResponse, type PassengerAnnouncement } from '@workspace/api-client-react';
import { AppText } from '@/components/AppText';
import { useColors } from '@/hooks/useColors';
import { passengerCopy, isRtlLanguage } from '@/lib/passenger-i18n';
import type { PassengerLanguage } from '@/lib/companion-preferences';

type Section = 'destinations' | 'fares' | 'guide' | 'contact' | 'amenities' | 'safety';
type InformationMode = 'service' | 'coach' | 'contact';
const infoCacheKey = 'passenger.serviceInformation.v1';
const serviceSections: Section[] = ['destinations', 'fares', 'guide'];
const coachSections: Section[] = ['amenities', 'safety'];
const contactSections: Section[] = ['contact'];

// Coach-specific guidance from the passenger display. Do not present this as equipment
// guaranteed on every vehicle; riders should check the markings on their own coach.
const coachGuidance = {
  en: {
    amenities: [
      ['Overhead USB', 'Overhead ports are beside the reading lamps.'],
      ['Outlet + USB panel', 'Seat outlets are centered between the seat backs.'],
      ['Before leaving', 'Unplug devices before leaving.'],
    ],
    safety: [
      ['Side windows', 'Lift the release bar at the sill. Push the bottom of the window outward.'],
      ['Roof hatch', 'Push up. Turn the knob ¼ turn toward “TO EXIT.” Push the knob, then push the hatch outward.'],
      ['Front entrance', 'Turn the marked interior unlatch air valve in the arrow direction, then push the door open.'],
    ],
  },
  he: {
    amenities: [
      ['USB עילי', 'שקעי ה-USB העיליים נמצאים לצד מנורות הקריאה.'],
      ['שקע ולוח USB', 'השקעים נמצאים במרכז בין גב המושבים.'],
      ['לפני הירידה', 'נתקו מכשירים לפני הירידה.'],
    ],
    safety: [
      ['חלונות צד', 'הרימו את מוט השחרור באדן. דחפו את תחתית החלון החוצה.'],
      ['פתח גג', 'דחפו כלפי מעלה. סובבו את הכפתור רבע סיבוב לכיוון “TO EXIT”. דחפו את הכפתור ואז את הפתח החוצה.'],
      ['כניסה קדמית', 'סובבו את שסתום שחרור הדלת המסומן בכיוון החץ, ואז דחפו את הדלת לפתיחה.'],
    ],
  },
  yi: {
    amenities: [
      ['אויבערשטער USB', 'די אויבערשטע פאסן זענען ביי די ליינען לאמפן.'],
      ['אוטלעט און USB פאנעל', 'די אוטלעטס זענען אין צענטער צווישן די זיץ-רוקן.'],
      ['פארן ארויסגיין', 'אויסטשעקט מכשירים פארן ארויסגיין.'],
    ],
    safety: [
      ['זייטיגע פענצטער', 'הייבט דעם לאז-שטאנג ביים סיל. שטופט די אונטערשטע טייל פונעם פענצטער ארויס.'],
      ['דאך פתח', 'שטופט ארויף. דרייט דעם קנעפל א פערטל דריי צו “TO EXIT”. שטופט דעם קנעפל, דערנאך דעם פתח ארויס.'],
      ['פארנט אריינגאנג', 'דרייט דעם אנגעצייכנטן אינעווייניגער טיר-וואלווז אין דער פייל ריכטונג, דערנאך שטופט די טיר אפן.'],
    ],
  },
} satisfies Record<PassengerLanguage, Record<'amenities' | 'safety', string[][]>>;

function isSavedInfo(value: unknown): value is PassengerInfoResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PassengerInfoResponse>;
  return typeof record.reviewedAt === 'string'
    && !!record.content
    && (['en', 'yi', 'he'] as const).every(lang =>
      (['destinations', 'fares', 'guide', 'contact'] as const).every(section =>
        Array.isArray(record.content?.[lang]?.[section])
        && record.content[lang][section].every(card => typeof card.title === 'string' && typeof card.text === 'string')));
}

export function ServiceInformation({
  language, onClose, announcements, announcementsUnavailable, selectedRun = false, mode = 'service',
}: {
  language: PassengerLanguage;
  onClose: () => void;
  announcements?: PassengerAnnouncement[];
  announcementsUnavailable?: boolean;
  selectedRun?: boolean;
  mode?: InformationMode;
}) {
  const colors = useColors();
  const rtl = isRtlLanguage(language);
  const [section, setSection] = useState<Section>(mode === 'coach' ? 'amenities' : mode === 'contact' ? 'contact' : 'destinations');
  const [saved, setSaved] = useState<PassengerInfoResponse | null>(null);
  const { data, error, isPending, refetch } = useGetPassengerInfo({
    query: { queryKey: getGetPassengerInfoQueryKey(), staleTime: 5 * 60_000, refetchOnMount: 'always' },
  });

  useEffect(() => {
    void AsyncStorage.getItem(infoCacheKey).then(raw => {
      if (!raw) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isSavedInfo(parsed)) setSaved(parsed);
      } catch { /* Invalid saved information is not displayed. */ }
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (data && isSavedInfo(data)) {
      setSaved(data);
      void AsyncStorage.setItem(infoCacheKey, JSON.stringify(data)).catch(() => undefined);
    }
  }, [data]);

  const info = !error && data && isSavedInfo(data) ? data : saved;
  const cards = section === 'safety' || section === 'amenities'
    ? coachGuidance[language][section].map(([title, text]) => ({ title, text }))
    : info?.content[language][section] ?? [];
  const textAlign = rtl ? 'right' : 'left';
  const title = (key: Parameters<typeof passengerCopy>[1]) => passengerCopy(language, key);
  const visibleSections = mode === 'coach' ? coachSections : mode === 'contact' ? contactSections : serviceSections;

  return (
    <Modal visible animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.header, { borderColor: colors.border, flexDirection: rtl ? 'row-reverse' : 'row' }]}>
           <AppText style={[styles.heading, { color: colors.foreground, textAlign }]}>
             {title(mode === 'coach' ? 'announcements' : mode === 'contact' ? 'companyContact' : 'serviceInfo')}
           </AppText>
           <Pressable onPress={onClose} accessibilityRole="button"
             accessibilityLabel={mode === 'coach' ? title('announcements') : title('closeInfo')} testID="close-service-info">
            <Feather name="x" size={25} color={colors.foreground} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
           {mode === 'coach' ? <View style={{ gap: 8 }}>
             <AppText style={[styles.heading, { color: colors.foreground, textAlign }]}>{title('tripUpdates')}</AppText>
            {announcementsUnavailable ? (
              <AppText style={[styles.warning, { color: colors.mutedForeground, textAlign }]}>{title('noticesUnavailable')}</AppText>
            ) : announcements?.length ? (
              announcements.map(item => (
                <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.arrival }]}>
                  <AppText style={[styles.cardTitle, { color: colors.foreground, textAlign }]}>{item.title}</AppText>
                  <AppText style={[styles.bodyText, { color: colors.mutedForeground, textAlign }]}>{item.message}</AppText>
                </View>
              ))
            ) : (
              <AppText style={[styles.warning, { color: colors.mutedForeground, textAlign }]}>
                {title(selectedRun ? 'noAnnouncements' : 'selectRunForAnnouncements')}
              </AppText>
            )}
           </View> : null}
           {mode !== 'contact' && <View style={[styles.choices, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
             {visibleSections.map(key => (
              <Pressable key={key} onPress={() => setSection(key)} accessibilityRole="tab"
                accessibilityState={{ selected: section === key }} testID={`service-info-${key}`}
                style={[styles.choice, { backgroundColor: section === key ? colors.primary : colors.card, borderColor: colors.border }]}>
                 <AppText style={{ color: section === key ? colors.primaryForeground : colors.foreground, fontWeight: '700' }}>
                    {title(key === 'safety' ? 'busSafety' : key === 'contact' ? 'companyContact' : key)}
                 </AppText>
              </Pressable>
            ))}
           </View>}
          {(section === 'amenities' || section === 'safety') ? (
            <AppText style={[styles.warning, { color: colors.mutedForeground, textAlign }]}>
              {title(section === 'safety' ? 'safetyContext' : 'amenitiesContext')}
            </AppText>
          ) : (
            <>
              {info && <AppText style={[styles.warning, { color: colors.mutedForeground, textAlign }]}>
                {title('reviewed')} {new Date(info.reviewedAt).toLocaleDateString(language === 'en' ? 'en-US' : language === 'he' ? 'he-IL' : 'yi')}
              </AppText>}
              {(error || !data) && info && <AppText style={[styles.warning, { color: colors.arrival, textAlign }]}>{title('savedInfo')}</AppText>}
              {info?.stale && <AppText style={[styles.warning, { color: colors.arrival, textAlign }]}>{title('overdueInfo')}</AppText>}
              {info?.changesDetected && <AppText style={[styles.warning, { color: colors.arrival, textAlign }]}>{title('changedInfo')}</AppText>}
              {!info && <View style={{ gap: 12 }}>
                <AppText style={{ color: colors.mutedForeground, textAlign }}>{isPending && !error ? title('loadingInfo') : title('unavailableInfo')}</AppText>
                <Pressable onPress={() => void refetch()} accessibilityRole="button" testID="retry-service-info">
                  <AppText style={{ color: colors.foreground, fontWeight: '700', textAlign }}>{title('retry')}</AppText>
                </Pressable>
              </View>}
            </>
          )}
          {cards.map((card, index) => (
            <View key={`${section}-${index}`} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <AppText style={[styles.cardTitle, { color: colors.foreground, textAlign }]}>{card.title}</AppText>
              <AppText style={[styles.bodyText, { color: colors.mutedForeground, textAlign }]}>{card.text}</AppText>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { padding: 18, borderBottomWidth: 1, justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  heading: { fontSize: 21, fontWeight: '800', flexShrink: 1 },
  body: { padding: 18, paddingBottom: 48, gap: 14 },
  choices: { flexWrap: 'wrap', gap: 8 },
  choice: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, borderWidth: 1 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  bodyText: { fontSize: 15, lineHeight: 23 },
  warning: { fontSize: 14, lineHeight: 20 },
});