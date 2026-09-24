import React, { useEffect, useState } from 'react';
import { View, ViewProps, StyleSheet, Platform, useColorScheme, AccessibilityInfo } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

import type { GlassViewProps } from 'expo-glass-effect';
export type SurfaceProps = ViewProps & {
  glassProps?: Partial<GlassViewProps>;
  variant?: 'card' | 'glass' | 'grouped';
};

export function Surface({ style, children, variant = 'card', glassProps, ...props }: SurfaceProps) {
  const theme = useColors();
  const isDark = useColorScheme() === 'dark';
  const [reduceTransparency, setReduceTransparency] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => {
      if (active) setReduceTransparency(value);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => { active = false; subscription.remove(); };
  }, []);
  const liquidAvailable = Platform.OS === 'ios' && !reduceTransparency && isLiquidGlassAvailable();

  if (variant === 'glass') {
    return (
      <View style={[styles.glassWrapper, style]} {...props}>
        {liquidAvailable ? (
          <GlassView style={StyleSheet.absoluteFill} colorScheme={isDark ? 'dark' : 'light'} {...glassProps} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.card }]} />
        )}
        <View style={styles.glassContent}>{children}</View>
      </View>
    );
  }

  const backgroundColor = theme.card;

  return (
    <View
      style={[
        { backgroundColor },
        variant === 'card' && [styles.cardElevated, { borderColor: theme.border }],
        variant === 'grouped' && [styles.groupedList, { borderColor: theme.border }],
        style
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  groupedList: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardElevated: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
  },
  glassWrapper: {
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  glassContent: {
    zIndex: 1,
  },
});
