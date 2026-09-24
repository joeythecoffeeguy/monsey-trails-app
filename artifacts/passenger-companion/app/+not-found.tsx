import { Link, Stack } from 'expo-router';
import { AppText } from "@/components/AppText";
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <AppText style={[styles.title, { color: colors.foreground }]}>
          This screen doesn&apos;t exist.
        </AppText>

        <Link href="/" style={styles.link}>
          <AppText style={[styles.linkText, { color: colors.primary }]}>
            Go to home screen!
          </AppText>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
  },
});
