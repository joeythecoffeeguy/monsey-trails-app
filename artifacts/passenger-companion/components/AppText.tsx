import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';

export function AppText({ style, ...props }: TextProps) {
  // Extract font weight from style to map to Plus Jakarta Sans
  let weight = '400';
  const flattenedStyle = StyleSheet.flatten(style) || {};
  if (flattenedStyle.fontWeight) {
    if (['normal', '400'].includes(String(flattenedStyle.fontWeight))) weight = '400';
    else if (['medium', '500'].includes(String(flattenedStyle.fontWeight))) weight = '500';
    else if (['semibold', '600'].includes(String(flattenedStyle.fontWeight))) weight = '600';
    else if (['bold', '700'].includes(String(flattenedStyle.fontWeight))) weight = '700';
    else if (['800', '900', 'black', 'heavy'].includes(String(flattenedStyle.fontWeight))) weight = '800';
  }

  const fontFamily = {
    '400': 'PlusJakartaSans_400Regular',
    '500': 'PlusJakartaSans_500Medium',
    '600': 'PlusJakartaSans_600SemiBold',
    '700': 'PlusJakartaSans_700Bold',
    '800': 'PlusJakartaSans_800ExtraBold',
  }[weight];

  return <Text style={[{ fontFamily }, style]} {...props} />;
}
