import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ItemReveal } from '@/components/item-reveal';
import { PaywallModal } from '@/components/paywall-modal';
import { PhotoTipsModal } from '@/components/photo-tips-modal';
import { ProcessingOverlay } from '@/components/processing-overlay';
import { AppColors, VestroFonts } from '@/constants/theme';
import { useAddClothing } from '@/hooks/use-add-clothing';
import { useI18n } from '@/i18n/context';
import { useAppTheme } from '@/theme/context';

function AddTabButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);

  return (
    <View style={styles.addTabSlot} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.addTabButton}
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('tabs.add')}
      >
        <Ionicons name="add" size={26} color={VestroColors.buttonText} />
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  const { t } = useI18n();
  const { colors: VestroColors } = useAppTheme();
  const styles = useMemo(() => createStyles(VestroColors), [VestroColors]);
  const {
    addClothing,
    isProcessing,
    processingImageUri,
    batchStep,
    revealItems,
    finishReveal,
    photoTipsVisible,
    closePhotoTips,
    onPhotoTipsDismissed,
    paywallVisible,
    dismissPaywall,
    cancelProcessing,
  } = useAddClothing();

  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: VestroColors.ink,
          tabBarInactiveTintColor: VestroColors.muted,
          tabBarStyle: {
            backgroundColor: VestroColors.background,
            borderTopWidth: 1,
            borderTopColor: VestroColors.border,
            height: 88,
            paddingTop: 10,
          },
          tabBarLabelStyle: {
            fontFamily: VestroFonts.sansSemiBold,
            fontSize: 10,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.home'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" color={color} size={size - 3} />
            ),
          }}
        />

        <Tabs.Screen
          name="explore"
          options={{
            title: t('tabs.dressing'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="shirt-outline" color={color} size={size - 3} />
            ),
          }}
        />

        <Tabs.Screen
          name="add"
          options={{
            tabBarLabel: () => null,
            tabBarButton: () => <AddTabButton onPress={addClothing} disabled={isProcessing} />,
          }}
        />

        <Tabs.Screen
          name="tenues"
          options={{
            title: t('tabs.outfits'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="albums-outline" color={color} size={size - 3} />
            ),
          }}
        />

        <Tabs.Screen
          name="wishlist"
          options={{
            title: t('tabs.wishlist'),
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="heart-outline" color={color} size={size - 3} />
            ),
          }}
        />
      </Tabs>

      <ProcessingOverlay
        visible={isProcessing}
        imageUri={processingImageUri}
        stepIndex={batchStep.index}
        stepCount={batchStep.count}
        onCancel={cancelProcessing}
      />

      <ItemReveal items={revealItems} visible={revealItems.length > 0} onDone={finishReveal} />

      <PhotoTipsModal
        visible={photoTipsVisible}
        onContinue={closePhotoTips}
        onDismiss={onPhotoTipsDismissed}
      />

      <PaywallModal visible={paywallVisible} onClose={dismissPaywall} />
    </View>
  );
}

const createStyles = (VestroColors: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
  },
  addTabSlot: {
    flex: 1,
    alignItems: 'center',
  },
  addTabButton: {
    marginTop: -26,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: VestroColors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
});
