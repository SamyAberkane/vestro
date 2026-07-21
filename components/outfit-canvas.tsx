import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { VestroColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';

const SELECTION_BLUE = '#2F7CF6';

export type CanvasLayout = { x: number; y: number; scale: number };

export type CanvasItem = {
  id: number;
  category: string;
  color?: string;
  image?: string;
};

const DEFAULT_POSITIONS: Record<string, { x: number; y: number }> = {
  Hauts: { x: 30, y: 10 },
  Bas: { x: 30, y: 150 },
  Chaussures: { x: 30, y: 290 },
  Accessoires: { x: 190, y: 10 },
};

const ITEM_SIZE = 130;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

export const CANVAS_REFERENCE_SIZE = { width: 340, height: 420 };

function resolveLayout(items: CanvasItem[], layout: Record<number, CanvasLayout>) {
  const categoryCounts: Record<string, number> = {};

  return items.map((item) => {
    const base = DEFAULT_POSITIONS[item.category] ?? { x: 20, y: 20 };
    const stackIndex = categoryCounts[item.category] ?? 0;
    categoryCounts[item.category] = stackIndex + 1;

    const fallback = { x: base.x + stackIndex * 18, y: base.y + stackIndex * 18 };
    const itemLayout = layout[item.id] ?? { ...fallback, scale: 1 };

    return { item, itemLayout };
  });
}

const CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const;
type Corner = (typeof CORNERS)[number];

const CORNER_SIGN: Record<Corner, { x: number; y: number }> = {
  topLeft: { x: -1, y: -1 },
  topRight: { x: 1, y: -1 },
  bottomLeft: { x: -1, y: 1 },
  bottomRight: { x: 1, y: 1 },
};

function ResizeHandle({
  corner,
  savedScale,
  currentScale,
  onCommit,
}: {
  corner: Corner;
  savedScale: { value: number };
  currentScale: { value: number };
  onCommit: () => void;
}) {
  const sign = CORNER_SIGN[corner];

  const resize = Gesture.Pan()
    .onUpdate((event) => {
      'worklet';
      const reach = event.translationX * sign.x + event.translationY * sign.y;
      const factor = 1 + reach / ITEM_SIZE;
      currentScale.value = Math.min(Math.max(savedScale.value * factor, MIN_SCALE), MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = currentScale.value;
      runOnJS(onCommit)();
    });

  return (
    <GestureDetector gesture={resize}>
      <View style={[styles.handle, HANDLE_POSITION[corner]]} hitSlop={12} />
    </GestureDetector>
  );
}

function DraggableItem({
  item,
  layout,
  selected,
  onChange,
  onSelect,
}: {
  item: CanvasItem;
  layout: CanvasLayout;
  selected: boolean;
  onChange: (next: CanvasLayout) => void;
  onSelect: () => void;
}) {
  const translateX = useSharedValue(layout.x);
  const translateY = useSharedValue(layout.y);
  const savedScale = useSharedValue(layout.scale);
  const currentScale = useSharedValue(layout.scale);

  function commit() {
    onChange({
      x: translateX.value,
      y: translateY.value,
      scale: currentScale.value,
    });
  }

  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(onSelect)();
  });

  const pan = Gesture.Pan()
    .onChange((event) => {
      translateX.value += event.changeX;
      translateY.value += event.changeY;
    })
    .onEnd(() => {
      runOnJS(commit)();
    });

  const pinch = Gesture.Pinch()
    .onChange((event) => {
      currentScale.value = Math.min(
        Math.max(savedScale.value * event.scale, MIN_SCALE),
        MAX_SCALE
      );
    })
    .onEnd(() => {
      savedScale.value = currentScale.value;
      runOnJS(commit)();
    });

  const gesture = Gesture.Simultaneous(pan, pinch, tap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: currentScale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.item, animatedStyle]}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.image} resizeMode="contain" />
        ) : (
          <View
            style={[
              styles.placeholder,
              { backgroundColor: item.color ?? VestroColors.tints[item.category] },
            ]}
          />
        )}

        {selected && (
          <>
            <View style={styles.selectionBorder} pointerEvents="none" />
            {CORNERS.map((corner) => (
              <ResizeHandle
                key={corner}
                corner={corner}
                savedScale={savedScale}
                currentScale={currentScale}
                onCommit={commit}
              />
            ))}
          </>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

export function OutfitCanvas({
  items,
  layout,
  onLayoutChange,
  height = 420,
}: {
  items: CanvasItem[];
  layout: Record<number, CanvasLayout>;
  onLayoutChange: (itemId: number, next: CanvasLayout) => void;
  height?: number;
}) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <View style={[styles.canvas, { height }]}>
      {items.length === 0 && <Text style={styles.emptyText}>{t('canvas.empty')}</Text>}

      {resolveLayout(items, layout).map(({ item, itemLayout }) => (
        <DraggableItem
          key={item.id}
          item={item}
          layout={itemLayout}
          selected={selectedId === item.id}
          onChange={(next) => onLayoutChange(item.id, next)}
          onSelect={() =>
            setSelectedId((current) => (current === item.id ? null : item.id))
          }
        />
      ))}
    </View>
  );
}

export function OutfitPreview({
  items,
  layout,
  size = 172,
}: {
  items: CanvasItem[];
  layout: Record<number, CanvasLayout>;
  size?: number;
}) {
  const scale = Math.min(
    size / CANVAS_REFERENCE_SIZE.width,
    size / CANVAS_REFERENCE_SIZE.height
  );

  return (
    <View style={[styles.canvas, styles.previewOuter, { width: size, height: size }]}>
      <View
        style={[
          styles.previewInner,
          {
            width: CANVAS_REFERENCE_SIZE.width,
            height: CANVAS_REFERENCE_SIZE.height,
            transform: [{ scale }],
          },
        ]}
      >
        {resolveLayout(items, layout).map(({ item, itemLayout }) => (
          <View
            key={item.id}
            style={[
              styles.item,
              {
                transform: [
                  { translateX: itemLayout.x },
                  { translateY: itemLayout.y },
                  { scale: itemLayout.scale },
                ],
              },
            ]}
          >
            {item.image ? (
              <Image source={{ uri: item.image }} style={styles.image} resizeMode="contain" />
            ) : (
              <View
                style={[
                  styles.placeholder,
                  { backgroundColor: item.color ?? VestroColors.tints[item.category] },
                ]}
              />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: VestroColors.frame,
    overflow: 'hidden',
  },
  previewOuter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewInner: {
    overflow: 'hidden',
  },
  emptyText: {
    position: 'absolute',
    top: '45%',
    width: '100%',
    textAlign: 'center',
    fontFamily: VestroFonts.serifMediumItalic,
    fontSize: 15,
    color: VestroColors.muted,
  },
  item: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: ITEM_SIZE,
    height: ITEM_SIZE,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  selectionBorder: {
    position: 'absolute',
    left: -2,
    top: -2,
    right: -2,
    bottom: -2,
    borderWidth: 2,
    borderColor: SELECTION_BLUE,
    borderRadius: 4,
  },
  handle: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: SELECTION_BLUE,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  handle_topLeft: {
    left: -9,
    top: -9,
  },
  handle_topRight: {
    right: -9,
    top: -9,
  },
  handle_bottomLeft: {
    left: -9,
    bottom: -9,
  },
  handle_bottomRight: {
    right: -9,
    bottom: -9,
  },
});

const HANDLE_POSITION: Record<Corner, object> = {
  topLeft: styles.handle_topLeft,
  topRight: styles.handle_topRight,
  bottomLeft: styles.handle_bottomLeft,
  bottomRight: styles.handle_bottomRight,
};
