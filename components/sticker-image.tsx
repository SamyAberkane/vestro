import { Image, StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

type StickerImageProps = {
  uri: string;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  resizeMode?: 'contain' | 'cover';
};

// The background-removal flood fill (see utils/remove-background.ts) can't
// always tell a near-white pixel inside the garment itself apart from the
// background it's cutting away, so a few of those pixels stay transparent
// inside the sticker instead of just around it. Backing every sticker with
// a fixed white card — always, regardless of the app's own light/dark theme
// — keeps those leftover gaps invisible (white-on-white) instead of showing
// through as a dark patch whenever the surface behind it is dark.
export function StickerImage({ uri, style, containerStyle, resizeMode = 'contain' }: StickerImageProps) {
  return (
    <View style={[containerStyle, styles.backing]}>
      <Image source={{ uri }} style={[styles.image, style]} resizeMode={resizeMode} />
    </View>
  );
}

const styles = StyleSheet.create({
  backing: {
    backgroundColor: '#FFFFFF',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
