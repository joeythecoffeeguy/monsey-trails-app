import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { AppText } from '@/components/AppText';
import { useColors } from '@/hooks/useColors';
import { isRtlLanguage } from '@/lib/passenger-i18n';
import type { PassengerLanguage } from '@/lib/companion-preferences';
import { usePassengerAccount } from '@/lib/passenger-account';

export type MoreMenuProps = {
  language: PassengerLanguage;
  onClose: () => void;
  onService: () => void;
  onCoach: () => void;
  onContact: () => void;
  onSchedule: () => void;
  scheduleBusy: boolean;
  scheduleError: string;
  onSettings: () => void;
  guestSavedRouteCount: number;
  onImportGuestRoutes: () => void;
  importBusy: boolean;
  syncError: string;
  onRefreshJourneys: () => void;
};

const menuStrings = {
  en: {
    menu: 'More',
    close: 'Close More',
    comingSoon: 'Coming Soon',
    futureFeatures: 'Ticket purchases and fare-card refills are planned. Browse schedules and service information without an account.',
    services: 'Services',
    serviceInfo: 'Service information',
    serviceInfoDesc: 'Destinations, fares & passenger guide',
    schedulePdf: 'Download schedule PDF',
    schedulePdfDesc: 'Tishrei 2026 · New York Line',
    updates: 'Updates',
    coachAnnouncements: 'Coach announcements',
    coachAnnouncementsDesc: 'Trip updates, safety & amenities',
    general: 'General',
    settings: 'Settings',
    settingsDesc: 'Language & preferences',
    contact: 'Company contact',
    contactDesc: 'Phone, email & headquarters',
    account: 'Your passenger account',
    accountHelp: 'Saved boarding routes follow you across devices. Tickets and refills are not available yet.',
    guestAccount: 'Save routes across devices',
    guestAccountHelp: 'Create a free account for your saved boarding routes. Schedules and trip information stay available without signing in.',
    signIn: 'Sign in',
    signUp: 'Create account',
    signOut: 'Sign out',
    importRoutes: 'Import routes saved on this phone',
    retrySync: 'Retry saved journeys sync',
    accountLoading: 'Checking account…',
    accountUnavailable: 'Accounts are temporarily unavailable. You can still browse schedules and trip information.',
  },
  he: {
    menu: 'עוד',
    close: 'סגור תפריט',
    comingSoon: 'בקרוב',
    futureFeatures: 'רכישת כרטיסים וטעינת כרטיסי נסיעה מתוכננות. אפשר לעיין בלוחות זמנים ובמידע על השירות ללא חשבון.',
    services: 'שירותים',
    serviceInfo: 'מידע על השירות',
    serviceInfoDesc: 'יעדים, תעריפים ומדריך לנוסע',
    schedulePdf: 'הורדת לוח זמנים PDF',
    schedulePdfDesc: 'תשרי 2026 · קו ניו יורק',
    updates: 'עדכונים',
    coachAnnouncements: 'הודעות אוטובוס',
    coachAnnouncementsDesc: 'עדכוני נסיעה, בטיחות ושירותים',
    general: 'כללי',
    settings: 'הגדרות',
    settingsDesc: 'שפה והעדפות',
    contact: 'יצירת קשר עם החברה',
    contactDesc: 'טלפון, אימייל ומשרדי החברה',
    account: 'חשבון הנוסע שלך',
    accountHelp: 'מסלולים שמורים זמינים במכשירים שלך. כרטיסים וטעינות עדיין אינם זמינים.',
    guestAccount: 'שמירת מסלולים בין מכשירים',
    guestAccountHelp: 'אפשר ליצור חשבון חינם למסלולי עלייה שמורים. לוחות זמנים ומידע על נסיעות זמינים גם ללא חשבון.',
    signIn: 'כניסה',
    signUp: 'יצירת חשבון',
    signOut: 'התנתקות',
    importRoutes: 'ייבוא מסלולים שנשמרו בטלפון',
    retrySync: 'ניסיון נוסף לסנכרן מסלולים',
    accountLoading: 'בודק חשבון…',
    accountUnavailable: 'חשבונות אינם זמינים כרגע. עדיין אפשר לעיין בלוחות זמנים ובמידע על נסיעות.',
  },
  yi: {
    menu: 'מער',
    close: 'מאך צו מעניו',
    comingSoon: 'בקרוב',
    futureFeatures: 'קויפן טיקעטס און אויפלאדן פארקארטלעך איז אין פלאן. מען קען זען צייטפלאנען און סערוויס אינפארמאציע אן אקאונט.',
    services: 'סערוויסעס',
    serviceInfo: 'סערוויס אינפארמאציע',
    serviceInfoDesc: 'צילן, פרייזן און אנווייזער',
    schedulePdf: 'אראָפּלאָדן צייטפּלאַן PDF',
    schedulePdfDesc: 'תשרי 2026 · ניו יארק ליניע',
    updates: 'אפדעיטס',
    coachAnnouncements: 'באס מעלדונגען',
    coachAnnouncementsDesc: 'רייזע אפדעיטס, זיכערהייט און צוגעהערן',
    general: 'אלגעמיין',
    settings: 'סעטינגס',
    settingsDesc: 'שפראך און פרעפערענצן',
    contact: 'קאָנטאַקט מיט דער פֿירמע',
    contactDesc: 'טעלעפאן, אימעיל און הויפטקווארטיר',
    account: 'אייער פאסאזשיר־קאנטע',
    accountHelp: 'אייערע געראטעוועטע רוטעס זענען אויף אלע אייערע מכשירים. טיקעטס און אויפלאדונגען זענען נאך נישט פאראן.',
    guestAccount: 'היטן רוטעס אויף אלע מכשירים',
    guestAccountHelp: 'שאפט א פרייע קאנטע פאר געראטעוועטע רוטעס. צייטפלאנען און רייזע אינפארמאציע בלייבן אפן אן א קאנטע.',
    signIn: 'אריינלאגירן',
    signUp: 'שאפן קאנטע',
    signOut: 'ארויסלאגירן',
    importRoutes: 'ארייננעמען רוטעס פון דעם טעלעפאן',
    retrySync: 'פרובירן נאכאמאל סינכראָניזירן',
    accountLoading: 'קוקט נאך קאנטע…',
    accountUnavailable: 'קאנטעס זענען יעצט נישט פאראן. מען קען ווייטער זען צייטפלאנען און רייזע אינפארמאציע.',
  },
} satisfies Record<PassengerLanguage, Record<string, string>>;

export function MoreMenu({
  language,
  onClose,
  onService,
  onCoach,
  onContact,
  onSchedule,
  scheduleBusy,
  scheduleError,
  onSettings,
  guestSavedRouteCount,
  onImportGuestRoutes,
  importBusy,
  syncError,
  onRefreshJourneys,
}: MoreMenuProps) {
  const colors = useColors();
  const router = useRouter();
  const { configured, isLoaded, isSignedIn, email, signOut } = usePassengerAccount();
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState('');
  const rtl = isRtlLanguage(language);
  const t = menuStrings[language] || menuStrings.en;
  const textAlign = rtl ? 'right' : 'left';
  const openAuth = (path: '/sign-in' | '/sign-up') => {
    onClose();
    setTimeout(() => router.push(path), 350);
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderColor: colors.border, flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          <AppText style={[styles.heading, { color: colors.foreground }]}>{t.menu}</AppText>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t.close}
            testID="close-more-menu"
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
          >
            <Feather name="x" size={24} color={colors.foreground} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} alwaysBounceVertical={false}>
          {/* Passenger accounts are optional: browsing remains public. */}
          <View style={[styles.guestCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.guestHeader, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
              <Feather name="user" size={20} color={colors.primary} />
              <AppText style={[styles.guestTitle, { color: colors.foreground, textAlign }]}>
                {!configured ? t.guestAccount : !isLoaded ? t.accountLoading : isSignedIn ? t.account : t.guestAccount}
              </AppText>
            </View>
            <AppText style={[styles.guestText, { color: colors.mutedForeground, textAlign }]}>
              {!configured ? t.accountUnavailable : isSignedIn ? (email ?? t.accountHelp) : t.guestAccountHelp}
            </AppText>
            {isSignedIn ? (
              <>
                <AppText style={[styles.guestText, { color: colors.mutedForeground, textAlign }]}>{t.accountHelp}</AppText>
                {guestSavedRouteCount > 0 && (
                  <Pressable
                    onPress={onImportGuestRoutes}
                    disabled={importBusy}
                    accessibilityRole="button"
                    style={[styles.accountAction, { backgroundColor: colors.primary }, importBusy && { opacity: 0.5 }]}
                  >
                    <AppText style={[styles.accountActionText, { color: colors.primaryForeground }]}>{t.importRoutes} ({guestSavedRouteCount})</AppText>
                  </Pressable>
                )}
                {syncError && (
                  <Pressable onPress={onRefreshJourneys} accessibilityRole="button">
                    <AppText style={{ color: colors.destructive }}>{syncError} · {t.retrySync}</AppText>
                  </Pressable>
                )}
                <Pressable
                  onPress={async () => {
                    setSigningOut(true);
                    setAccountError('');
                    try {
                      await signOut();
                      onClose();
                    } catch {
                      setAccountError('Could not sign out. Please try again.');
                    } finally {
                      setSigningOut(false);
                    }
                  }}
                  disabled={signingOut}
                  accessibilityRole="button"
                  style={[styles.accountAction, { borderWidth: 1, borderColor: colors.border }]}
                >
                  <AppText style={[styles.accountActionText, { color: colors.foreground }]}>{t.signOut}</AppText>
                </Pressable>
                {accountError ? <AppText accessibilityRole="alert" style={{ color: colors.destructive }}>{accountError}</AppText> : null}
              </>
            ) : configured && isLoaded ? (
              <View style={[styles.accountActions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                <Pressable onPress={() => openAuth('/sign-up')} accessibilityRole="button" style={[styles.accountAction, { backgroundColor: colors.primary }]}>
                  <AppText style={[styles.accountActionText, { color: colors.primaryForeground }]}>{t.signUp}</AppText>
                </Pressable>
                <Pressable onPress={() => openAuth('/sign-in')} accessibilityRole="button" style={[styles.accountAction, { borderWidth: 1, borderColor: colors.border }]}>
                  <AppText style={[styles.accountActionText, { color: colors.foreground }]}>{t.signIn}</AppText>
                </Pressable>
              </View>
            ) : null}
            <AppText style={[styles.guestText, { color: colors.mutedForeground, textAlign }]}>{t.futureFeatures}</AppText>
          </View>

          {/* Services Section */}
          <View style={styles.section}>
            <AppText style={[styles.sectionTitle, { color: colors.mutedForeground, textAlign }]}>
              {t.services}
            </AppText>
            <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MenuRow
                icon="map"
                title={t.serviceInfo}
                subtitle={t.serviceInfoDesc}
                onPress={() => {
                  onClose();
                  onService();
                }}
                testID="more-service-information"
                rtl={rtl}
                colors={colors}
              />
              <MenuRow
                icon="download"
                title={scheduleBusy ? `${t.schedulePdf}…` : t.schedulePdf}
                subtitle={t.schedulePdfDesc}
                onPress={onSchedule}
                disabled={scheduleBusy}
                testID="more-schedule-pdf"
                isLast
                rtl={rtl}
                colors={colors}
              />
            </View>
            {scheduleError ? <AppText accessibilityRole="alert" style={{ color: colors.destructive, textAlign }}>{scheduleError}</AppText> : null}
          </View>

          {/* Updates Section */}
          <View style={styles.section}>
            <AppText style={[styles.sectionTitle, { color: colors.mutedForeground, textAlign }]}>
              {t.updates}
            </AppText>
            <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MenuRow
                icon="phone"
                title={t.contact}
                subtitle={t.contactDesc}
                onPress={() => {
                  onClose();
                  onContact();
                }}
                testID="more-company-contact"
                rtl={rtl}
                colors={colors}
              />
              <MenuRow
                icon="bell"
                title={t.coachAnnouncements}
                subtitle={t.coachAnnouncementsDesc}
                onPress={() => {
                  onClose();
                  onCoach();
                }}
                testID="more-coach-announcements"
                isLast
                rtl={rtl}
                colors={colors}
              />
            </View>
          </View>

          {/* General Section */}
          <View style={styles.section}>
            <AppText style={[styles.sectionTitle, { color: colors.mutedForeground, textAlign }]}>
              {t.general}
            </AppText>
            <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MenuRow
                icon="settings"
                title={t.settings}
                subtitle={t.settingsDesc}
                onPress={() => {
                  onClose();
                  onSettings();
                }}
                testID="more-settings"
                isLast
                rtl={rtl}
                colors={colors}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function MenuRow({
  icon,
  title,
  subtitle,
  onPress,
  disabled,
  testID,
  isLast,
  rtl,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  isLast?: boolean;
  rtl: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const alignText = rtl ? 'right' : 'left';
  const flexDirection = rtl ? 'row-reverse' : 'row';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.border : 'transparent',
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
          flexDirection,
        },
      ]}
    >
      <View style={[styles.rowLeft, { flexDirection }]}>
        <View style={styles.iconContainer}>
          <Feather name={icon} size={22} color={colors.foreground} />
        </View>
        <View style={[styles.textContainer, { alignItems: rtl ? 'flex-end' : 'flex-start' }]}>
          <AppText style={[styles.rowTitle, { color: colors.foreground, textAlign: alignText }]}>
            {title}
          </AppText>
          {subtitle && (
            <AppText style={[styles.rowSubtitle, { color: colors.mutedForeground, textAlign: alignText }]}>
              {subtitle}
            </AppText>
          )}
        </View>
      </View>
      <Feather name={rtl ? 'chevron-left' : 'chevron-right'} size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
    margin: -4,
  },
  body: {
    padding: 16,
    paddingBottom: 48,
    gap: 24,
  },
  guestCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  guestHeader: {
    alignItems: 'center',
    gap: 8,
  },
  guestTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  guestText: {
    fontSize: 14,
    lineHeight: 20,
  },
  accountActions: { gap: 10, flexWrap: 'wrap' },
  accountAction: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  accountActionText: { fontSize: 14, fontWeight: '700' },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 8,
  },
  group: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    padding: 16,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLeft: {
    alignItems: 'center',
    gap: 16,
    flex: 1,
  },
  iconContainer: {
    width: 24,
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
});
