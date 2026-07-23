import { View } from 'react-native';

// This route is never navigated to: the "add" tab button in (tabs)/_layout.tsx
// overrides tabBarButton and triggers the photo picker directly instead of
// routing here. The file only needs to exist for expo-router to accept the tab.
export default function AddTabPlaceholder() {
  return <View />;
}
