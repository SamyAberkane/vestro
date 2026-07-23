import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VestroColors, VestroFonts } from '@/constants/theme';

type LegalScreenProps = {
  title: string;
  children: ReactNode;
};

export function LegalScreen({ title, children }: LegalScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity
          style={[styles.closeButton, { top: insets.top + 12 }]}
          onPress={() => router.back()}
          hitSlop={10}
        >
          <Text style={styles.closeGlyph}>×</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{title}</Text>
        {children}
      </ScrollView>
    </View>
  );
}

export function LegalHeading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function LegalParagraph({ children }: { children: ReactNode }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VestroColors.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 70,
    paddingBottom: 60,
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: VestroColors.surface,
    zIndex: 1,
  },
  closeGlyph: {
    fontSize: 20,
    lineHeight: 22,
    color: VestroColors.muted,
  },
  title: {
    fontFamily: VestroFonts.serifSemiBoldItalic,
    fontSize: 26,
    color: VestroColors.ink,
    marginBottom: 20,
  },
  heading: {
    marginTop: 22,
    marginBottom: 6,
    fontFamily: VestroFonts.serifSemiBold,
    fontSize: 15,
    color: VestroColors.ink,
  },
  paragraph: {
    marginBottom: 6,
    fontFamily: VestroFonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: VestroColors.muted,
  },
});
