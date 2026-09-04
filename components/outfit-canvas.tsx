import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { VestroColors, VestroFonts } from '@/constants/theme';
import { useI18n } from '@/i18n/context';
import type { Language } from '@/i18n/translations';
import { formatPrice as formatCurrency } from '@/utils/currency';

const SELECTION_BLUE = '#2F7CF6';

// x/y are fractions (0..1) of the canvas' usable travel range (canvas size
// minus the item's own footprint), NOT pixels — so "all the way at the
// bottom" (y: 1) always renders at the bottom of whatever canvas shows it,
// whether that's the compact home-screen builder, the outfit list preview,
// or the full-screen editor, regardless of their differing pixel sizes.
// z is the stacking order (higher = more in front); items without one stack
// by their natural array order.
//
// x/y/scale are all optional because an item can have a saved z (stacking
// order) WITHOUT ever having been manually positioned — see bringToFront in
// OutfitCanvas below, which merely selecting or touching an item goes
// through. Position is only ever written by an actual drag/resize (see
// DraggableItem's commit()). Writing x/y/scale from a mere tap would freeze
// that item's *current auto-grid position* (see autoGridLayout) as if it
// were deliberate — and since the auto-grid depends on how many items are
// in the outfit, an item frozen early (before the rest were added) can end
// up "stuck" at a position that no longer matches the live grid the other,
// still-unfrozen items are computed against, landing them on top of each
// other.
export type CanvasLayout = { x?: number; y?: number; scale?: number; z?: number };

// A layout that's actually usable to place an item on the board — every
// field guaranteed present, unlike the optional, "maybe just a z" CanvasLayout
// above. Only ever produced by autoGridLayout or by normalizing a saved
// entry that has real x/y (see normalizeStoredLayout) — never something a
// mere tap/select can create.
type ResolvedItemLayout = { x: number; y: number; scale: number };

export type CanvasItem = {
  id: number;
  category: string;
  color?: string;
  image?: string;
  imagePath?: string;
  price?: number;
};

function formatPrice(items: CanvasItem[], language: Language): string | null {
  const total = items.reduce((sum, item) => sum + (item.price ?? 0), 0);
  const hasPrice = items.some((item) => item.price !== undefined);
  if (!hasPrice) return null;
  return formatCurrency(total, language);
}

const ITEM_SIZE = 130;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
// Comfortably above any item's zIndex (items.length + 1 at most).
const PRICE_TAG_Z_INDEX = 10000;

export const CANVAS_REFERENCE_SIZE = { width: 340, height: 420 };

// Every layout computation below — travel, positions, clamping, the auto
// grid — happens in this one fixed 340x420 coordinate system, always. There
// is no "editor size" vs "preview size" version of this math to keep in
// sync: the interactive board (OutfitCanvas) and the read-only thumbnail
// (OutfitPreview) both lay out items in this same fixed space and then
// apply a single `transform: scale(...)` to whatever box they're actually
// asked to render into (see displayScale in OutfitCanvas, `scale` in
// OutfitPreview). Two parallel formulas that both have to independently
// arrive at the same answer is exactly the kind of thing that quietly
// drifts apart — one shared coordinate system can't disagree with itself.
const TRAVEL = {
  x: Math.max(CANVAS_REFERENCE_SIZE.width - ITEM_SIZE, 1),
  y: Math.max(CANVAS_REFERENCE_SIZE.height - ITEM_SIZE, 1),
};

function toPixels(fractionLayout: ResolvedItemLayout): ResolvedItemLayout {
  return { ...fractionLayout, x: fractionLayout.x * TRAVEL.x, y: fractionLayout.y * TRAVEL.y };
}

function toFraction(pixelLayout: ResolvedItemLayout): ResolvedItemLayout {
  return { ...pixelLayout, x: pixelLayout.x / TRAVEL.x, y: pixelLayout.y / TRAVEL.y };
}

// A scale that's zero, negative, or NaN (e.g. written by some earlier,
// since-fixed bug, or hand-edited data) would otherwise render an item at
// literally invisible size with no way for the user to know it's still
// there. Only applied to *saved* layouts below — autoGridLayout's own scale
// legitimately goes as low as AUTO_GRID_MIN_SCALE (below the interactive
// MIN_SCALE) to keep many items from overlapping, and must not be clamped
// back up here.
function sanitizeScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

function normalizeStoredLayout(raw: { x: number; y: number; scale?: number }): ResolvedItemLayout {
  return { x: raw.x, y: raw.y, scale: sanitizeScale(raw.scale) };
}

// Layouts saved before positions became 0..1 fractions of the canvas stored
// raw pixels against the old fixed 340x420 reference box instead — those are
// unmistakably outside the ~0..1 range fractions live in. Only items that
// had actually been dragged got one of these entries; every other item in
// that same outfit relied on an old fixed per-category slot that no longer
// exists in code at all. So a legacy entry can't just be rescaled in place:
// doing that would place the one item that happens to have a saved entry at
// its old (rescaled) spot while every untouched neighbor lands wherever the
// *current* per-item auto-grid puts it — two positioning schemes that know
// nothing about each other, landing arbitrary items on top of each other.
// The only self-consistent option once any item shows this shape is to
// treat the *whole outfit's* saved layout as unusable and let every item in
// it fall back to the auto-grid together (same as hitting "Réinitialiser la
// disposition") — not just the one legacy-shaped entry.
function looksLegacy(raw: { x: number; y: number }): boolean {
  return Math.abs(raw.x) > 1.5 || Math.abs(raw.y) > 1.5;
}

// A large item (jeans, a dress) at a size the user actually wants often
// can't fit fully within the board's fixed proportions without being shrunk
// smaller than they'd like — full containment fought that. Up to half of an
// item's own width/height is now allowed to hang off any edge (clipped by
// the frame's own overflow: hidden, same as a cropped product photo — not a
// bug, a normal moodboard interaction), same on every board size including
// a tablet's landscape one, since this works in the fixed reference space
// shared by every board shape. Only a runaway drag that would push an item
// fully out of view is still stopped.
const MAX_OVERFLOW_FRACTION = 0.5;

// A saved fraction can still fall outside 0..1 (dragged past an edge, a
// stack offset pushing past 1, or a resize that grew the item past where it
// used to fit) — this pulls it back within the allowed overflow range, in
// pixel space, so an item can never end up fully off-board with no way to
// find it again.
function clampToCanvas(itemLayout: ResolvedItemLayout): ResolvedItemLayout {
  const size = ITEM_SIZE * itemLayout.scale;
  const overflow = size * MAX_OVERFLOW_FRACTION;
  // x/y store the top-left of the item's *unscaled* (ITEM_SIZE) box — the
  // scale transform below then grows it around its own center, not around
  // x/y, so a scaled-up item's visual box is shifted by this much relative
  // to what x/y alone would suggest. Skipping this shift (as an earlier
  // version did) let the item drift further off one edge than the other
  // once scaled, instead of an equal MAX_OVERFLOW_FRACTION on both sides.
  const centerShift = (size - ITEM_SIZE) / 2;
  const minX = centerShift - overflow;
  const minY = centerShift - overflow;
  const maxX = Math.max(minX, CANVAS_REFERENCE_SIZE.width - ITEM_SIZE / 2 - size / 2 + overflow);
  const maxY = Math.max(minY, CANVAS_REFERENCE_SIZE.height - ITEM_SIZE / 2 - size / 2 + overflow);

  return {
    ...itemLayout,
    x: Math.min(Math.max(itemLayout.x, minX), maxX),
    y: Math.min(Math.max(itemLayout.y, minY), maxY),
  };
}

const MIN_BOARD_ZOOM = 1;
const MAX_BOARD_ZOOM = 3;

const AUTO_GRID_MAX_SCALE = 1;
const AUTO_GRID_MIN_SCALE = 0.4;

// Arranges items that haven't been manually positioned into a grid that's
// guaranteed not to overlap, sized to fit however many items there are.
// A fixed per-category lookup used to place items instead, but at this item
// size two adjacent columns already overlap at full scale (an item is ~62%
// of the travel range wide — three columns structurally can't fit side by
// side without overlapping), so any outfit with two items in neighboring
// category slots, or several items sharing one category, rendered as a
// near-total overlap by default instead of a clean, glanceable layout.
function autoGridLayout(index: number, total: number): ResolvedItemLayout {
  const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / cols));

  const itemFractionX = ITEM_SIZE / TRAVEL.x;
  const itemFractionY = ITEM_SIZE / TRAVEL.y;

  const scaleX = cols > 1 ? 1 / (cols - 1) / itemFractionX : AUTO_GRID_MAX_SCALE;
  const scaleY = rows > 1 ? 1 / (rows - 1) / itemFractionY : AUTO_GRID_MAX_SCALE;
  const scale = Math.max(AUTO_GRID_MIN_SCALE, Math.min(AUTO_GRID_MAX_SCALE, scaleX, scaleY));

  const col = index % cols;
  const row = Math.floor(index / cols);

  return {
    x: cols > 1 ? col / (cols - 1) : 0.5,
    y: rows > 1 ? row / (rows - 1) : 0.5,
    scale,
  };
}

// x/y going through Math.min/Math.max survives out-of-range values (that's
// what clampToCanvas is for) but NOT non-finite ones — Math.min(NaN, n) is
// NaN, which then makes the item's transform NaN and the item silently
// renders nothing, with no error and no way to tell it's still "there".
// A usable saved layout must have real numbers to build on; anything else
// (leftover from some earlier, since-fixed bug, or corrupted some other
// way) is treated as if nothing were saved at all, same as a brand new item.
function isUsableSaved(raw: CanvasLayout): raw is CanvasLayout & { x: number; y: number } {
  return Number.isFinite(raw.x) && Number.isFinite(raw.y);
}

function computeResolved(items: CanvasItem[], effectiveLayout: Record<number, CanvasLayout>) {
  return items.map((item, index) => {
    const saved = effectiveLayout[item.id];
    const itemLayout =
      saved && isUsableSaved(saved)
        ? clampToCanvas(toPixels(normalizeStoredLayout(saved)))
        : clampToCanvas(toPixels(autoGridLayout(index, items.length)));
    // z comes straight from the saved entry, never from the resolved
    // position — an item can have a saved z (from being tapped/dragged to
    // the front) with no saved x/y/scale at all, still using the live
    // auto-grid for its position (see CanvasLayout's comment above).
    const zIndex = saved?.z ?? index;

    return { item, itemLayout, zIndex };
  });
}

// The rendered/tappable box for an item, in the same on-screen pixel space
// as a tap event's x/y on the board — mirrors exactly what DraggableItem
// itself renders (translateX/Y = itemLayout.x/y * displayScale, scaled via
// a CSS transform that grows around the box's own center, same as
// clampToCanvas's centerShift correction). Used only for board-level tap
// hit-testing (see handleBoardTap in OutfitCanvas), never for layout itself.
function boxForItem(itemLayout: ResolvedItemLayout, displayScale: number) {
  const itemSize = ITEM_SIZE * displayScale;
  const centerX = itemLayout.x * displayScale + itemSize / 2;
  const centerY = itemLayout.y * displayScale + itemSize / 2;
  const halfSize = (itemSize * itemLayout.scale) / 2;

  return {
    left: centerX - halfSize,
    right: centerX + halfSize,
    top: centerY - halfSize,
    bottom: centerY + halfSize,
  };
}

// This used to ALSO wipe the whole saved layout back to auto-grid whenever
// any two items overlapped by more than 50%, on the theory that heavy
// overlap could only mean corrupted data from an old bug. It didn't — it
// just as easily meant the user deliberately layered two items closely (a
// belt over a dress, a jacket mostly covering a top), and every re-render
// while that overlap was on screen would silently snap everything back to
// grid, scrambling stacking order along with it. Placement (including
// deliberate overlap) is the user's call, never something this app decides
// on its own — see the no-auto-placement rule. Only genuinely malformed
// *data* (looksLegacy below) is still auto-corrected; a normal *result* the
// user chose never is, no matter how much it overlaps.
function resolveLayout(items: CanvasItem[], layout: Record<number, CanvasLayout>) {
  const hasLegacyEntry = Object.values(layout).some(
    (raw) => isUsableSaved(raw) && looksLegacy(raw)
  );
  const effectiveLayout = hasLegacyEntry ? {} : layout;
  return computeResolved(items, effectiveLayout);
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
  displayScale,
  onCommit,
}: {
  corner: Corner;
  savedScale: { value: number };
  currentScale: { value: number };
  displayScale: number;
  onCommit: () => void;
}) {
  const sign = CORNER_SIGN[corner];

  // onCommit is a fresh closure from DraggableItem on every render (it reads
  // the item's own latest onChange) — going through a ref instead of putting
  // it in the useMemo below keeps the underlying native Pan handler from
  // being torn down and rebuilt on every render, which is what let a finger
  // still resting on the handle end up attached to an already-destroyed
  // gesture (see the matching comment on DraggableItem's `pan`).
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const handleCommit = useCallback(() => onCommitRef.current(), []);

  const resize = useMemo(
    () =>
      Gesture.Pan().onUpdate((event) => {
        'worklet';
        // The handle is dragged in real screen pixels, but the item it's
        // resizing lives in the fixed reference space and is only ever made
        // to look bigger or smaller on screen via displayScale — so a drag of
        // the same *visual* distance should always produce the same size
        // change, regardless of how zoomed in or out this particular board is.
        const reach = event.translationX * sign.x + event.translationY * sign.y;
        const factor = 1 + reach / (ITEM_SIZE * displayScale);
        currentScale.value = Math.min(Math.max(savedScale.value * factor, MIN_SCALE), MAX_SCALE);
      }).onEnd(() => {
        savedScale.value = currentScale.value;
        runOnJS(handleCommit)();
      }),
    [sign, displayScale, currentScale, savedScale, handleCommit]
  );

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
  zIndex,
  displayScale,
  disabled,
  onChange,
  onTouch,
}: {
  item: CanvasItem;
  layout: ResolvedItemLayout;
  selected: boolean;
  zIndex: number;
  displayScale: number;
  /** True while the board itself is being pinch-zoomed (see OutfitCanvas) —
   * item drag/select/resize must stand down during that gesture, both so a
   * stray finger doesn't drag an item mid-pinch and because zooming is a
   * transient "look closer" view, not an editing mode. */
  disabled: boolean;
  onChange: (next: ResolvedItemLayout) => void;
  onTouch: () => void;
}) {
  // translateX/Y track the item's actual on-screen pixel position (logical
  // position × displayScale), not the fixed reference-space position — the
  // item is rendered at its real on-screen size below (ITEM_SIZE *
  // displayScale) rather than rendered small and stretched up by a
  // container transform, so the image is decoded at the resolution it's
  // actually shown at instead of coming out blurry on any board that isn't
  // exactly the reference size (which is almost every board).
  const translateX = useSharedValue(layout.x * displayScale);
  const translateY = useSharedValue(layout.y * displayScale);
  const savedScale = useSharedValue(layout.scale);
  const currentScale = useSharedValue(layout.scale);
  const itemSize = ITEM_SIZE * displayScale;

  // Keeps this item's on-screen position/scale in sync whenever the
  // *resolved* layout actually changes for a reason other than this item's
  // own live gesture (most importantly: clampToCanvas pulling it back fully
  // onto the board after a commit that would otherwise have left it, or a
  // stale corrupted entry, partly hidden behind the frame's clipped edge).
  // Only depends on the real numbers, not the `layout` object's identity —
  // OutfitCanvas re-resolves a fresh object for every item on every render
  // (e.g. a z-bump from selecting a different item), most of which leave
  // this item's own x/y/scale numerically unchanged and must not yank it
  // mid-gesture.
  useEffect(() => {
    translateX.value = layout.x * displayScale;
    translateY.value = layout.y * displayScale;
    savedScale.value = layout.scale;
    currentScale.value = layout.scale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.x, layout.y, layout.scale, displayScale]);

  // onChange/onTouch are fresh closures from OutfitCanvas on every render
  // (they capture that render's item.id) — going through refs instead of
  // depending on them directly lets `commit`/`handleTouch` stay referentially
  // stable, which in turn lets the `pan` gesture below stay memoized. Without
  // this, merely touching ANY item in the outfit re-renders OutfitCanvas
  // (via onTouch → bringToFront → setLayout in the parent), which rebuilt
  // every item's Gesture.Pan() from scratch on every render — including the
  // one still actively being dragged, tearing down and reattaching its
  // native handler mid-touch. That's what produced the freeze after a bit of
  // dragging around the board: a stale/orphaned native gesture recognizer
  // left the JS↔UI thread handshake stuck.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onTouchRef = useRef(onTouch);
  onTouchRef.current = onTouch;

  const commit = useCallback(() => {
    // Stacking order (z) isn't part of this — onTouch already bumped it to
    // the front at the start of this gesture via a separate call, and
    // OutfitCanvas merges that into the saved entry rather than this one
    // replacing it wholesale (see handleLayoutChange). translateX/Y are
    // on-screen pixels — convert back to the fixed reference space (what
    // onChange/toFraction expect) before saving.
    onChangeRef.current({
      x: translateX.value / displayScale,
      y: translateY.value / displayScale,
      scale: currentScale.value,
    });
  }, [translateX, translateY, currentScale, displayScale]);

  const handleTouch = useCallback(() => onTouchRef.current(), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        // Capped to a single finger so a second finger landing (the start of
        // a board-wide pinch-to-zoom — see OutfitCanvas) makes this fail
        // instead of both gestures fighting over the same touch; the corner
        // handles below remain the only way to resize an item, freeing a
        // pinch anywhere on the board to always mean "zoom", the same way it
        // does on a photo.
        .minPointers(1)
        .maxPointers(1)
        .onStart(() => {
          'worklet';
          runOnJS(handleTouch)();
        })
        .onChange((event) => {
          'worklet';
          // Stops the drag dead at the allowed-overflow edge instead of
          // letting it past and clamping afterwards, matching
          // clampToCanvas's own bounds exactly (see its comment and
          // MAX_OVERFLOW_FRACTION) so the live drag and the saved/resolved
          // position can never disagree — an item can hang up to half off
          // any side, on any board shape.
          const boardWidthPx = CANVAS_REFERENCE_SIZE.width * displayScale;
          const boardHeightPx = CANVAS_REFERENCE_SIZE.height * displayScale;
          const size = itemSize * currentScale.value;
          const overflow = size * MAX_OVERFLOW_FRACTION;
          // Same center-anchored-scale correction as clampToCanvas above.
          const centerShift = (size - itemSize) / 2;
          const minX = centerShift - overflow;
          const minY = centerShift - overflow;
          const maxX = Math.max(minX, boardWidthPx - itemSize / 2 - size / 2 + overflow);
          const maxY = Math.max(minY, boardHeightPx - itemSize / 2 - size / 2 + overflow);

          translateX.value = Math.min(Math.max(translateX.value + event.changeX, minX), maxX);
          translateY.value = Math.min(Math.max(translateY.value + event.changeY, minY), maxY);
        })
        .onEnd(() => {
          runOnJS(commit)();
        }),
    [disabled, displayScale, itemSize, currentScale, translateX, translateY, commit, handleTouch]
  );

  const gesture = pan;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: currentScale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.item, { width: itemSize, height: itemSize, zIndex }, animatedStyle]}
      >
        {item.image ? (
          <Image
            source={{ uri: item.image, cacheKey: item.imagePath }}
            style={styles.image}
            contentFit="contain"
          />
        ) : (
          <View
            style={[
              styles.placeholder,
              { backgroundColor: item.color ?? VestroColors.tints[item.category] },
            ]}
          />
        )}

        {selected && !disabled && (
          <>
            <View style={styles.selectionBorder} pointerEvents="none" />
            {CORNERS.map((corner) => (
              <ResizeHandle
                key={corner}
                corner={corner}
                savedScale={savedScale}
                currentScale={currentScale}
                displayScale={displayScale}
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
  width = CANVAS_REFERENCE_SIZE.width,
  height = CANVAS_REFERENCE_SIZE.height,
  showPrice = false,
}: {
  items: CanvasItem[];
  layout: Record<number, CanvasLayout>;
  onLayoutChange: (itemId: number, next: CanvasLayout) => void;
  width?: number;
  height?: number;
  showPrice?: boolean;
}) {
  const { t, language } = useI18n();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isZooming, setIsZooming] = useState(false);
  const priceLabel = showPrice ? formatPrice(items, language) : null;
  // Uniform scale that fits the fixed 340x420 reference board inside
  // whatever width x height box this screen actually has room for — the
  // same formula OutfitPreview below uses. Using width alone (as this used
  // to) silently assumed the box was always exactly reference-shaped; the
  // home screen's board area is a flexible, remaining-space region whose
  // real aspect ratio drifts from that assumption a lot on a wide, short
  // tablet layout, and items positioned toward the bottom of the reference
  // space (e.g. shoes, since bottom rows fill last) would end up translated
  // below the box's actual pixel height — clipped invisible by this view's
  // overflow: hidden, with no error and no way to tell they were still
  // "there". Deriving the scale from both dimensions, and sizing the
  // rendered frame itself to that result (boardWidth/boardHeight below)
  // rather than to the full available box, makes the editor agree with the
  // preview pixel-for-pixel no matter the box's shape, instead of
  // stretching content into — or leaving it dwarfed by — a box it was
  // never actually sized for.
  const displayScale = Math.min(
    width / CANVAS_REFERENCE_SIZE.width,
    height / CANVAS_REFERENCE_SIZE.height
  );
  const boardWidth = CANVAS_REFERENCE_SIZE.width * displayScale;
  const boardHeight = CANVAS_REFERENCE_SIZE.height * displayScale;

  // Pinch-to-zoom on the board itself, Instagram-photo style: a transient
  // "look closer" on top of the rendered board, not an editing tool and not
  // persisted anywhere — always springs back to untouched on release rather
  // than leaving the outfit magnified. Kept entirely separate from item
  // drag/resize (see DraggableItem's `disabled` prop and the 1-pointer cap
  // on its pan gesture) so a pinch is never ambiguous between "resize this
  // item" and "zoom the board" the way it would be if both listened for it.
  const boardScale = useSharedValue(1);
  const boardTranslateX = useSharedValue(0);
  const boardTranslateY = useSharedValue(0);
  const savedBoardTranslateX = useSharedValue(0);
  const savedBoardTranslateY = useSharedValue(0);

  const handleZoomStart = useCallback(() => setIsZooming(true), []);
  const handleZoomEnd = useCallback(() => setIsZooming(false), []);

  // Memoized (deps are all stable shared values, so this effectively builds
  // once) for the same reason as DraggableItem's `pan` — these gestures sit
  // on the outer view wrapping every item on the board, so rebuilding them
  // on every render (which used to happen on every single item touch, via
  // bringToFront → setLayout in the parent → a re-render here) risked
  // tearing down the whole board's native gesture handler mid-touch.
  const boardPinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          'worklet';
          runOnJS(handleZoomStart)();
        })
        .onUpdate((event) => {
          boardScale.value = Math.min(Math.max(event.scale, MIN_BOARD_ZOOM), MAX_BOARD_ZOOM);
        })
        .onEnd(() => {
          boardScale.value = withSpring(1);
          boardTranslateX.value = withSpring(0);
          boardTranslateY.value = withSpring(0);
          savedBoardTranslateX.value = 0;
          savedBoardTranslateY.value = 0;
          runOnJS(handleZoomEnd)();
        }),
    [
      boardScale,
      boardTranslateX,
      boardTranslateY,
      savedBoardTranslateX,
      savedBoardTranslateY,
      handleZoomStart,
      handleZoomEnd,
    ]
  );

  // Two fingers only, so this never competes with an item's own 1-finger
  // drag (see DraggableItem's pan) — panning around a zoomed-in board only
  // makes sense once you're already pinching with two fingers anyway.
  const boardPan = useMemo(
    () =>
      Gesture.Pan()
        .minPointers(2)
        .maxPointers(2)
        .onUpdate((event) => {
          if (boardScale.value <= 1) return;
          boardTranslateX.value = savedBoardTranslateX.value + event.translationX;
          boardTranslateY.value = savedBoardTranslateY.value + event.translationY;
        })
        .onEnd(() => {
          savedBoardTranslateX.value = boardTranslateX.value;
          savedBoardTranslateY.value = boardTranslateY.value;
        }),
    [boardScale, boardTranslateX, boardTranslateY, savedBoardTranslateX, savedBoardTranslateY]
  );

  const boardZoomGesture = useMemo(
    () => Gesture.Simultaneous(boardPinch, boardPan),
    [boardPinch, boardPan]
  );

  const boardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: boardTranslateX.value },
      { translateY: boardTranslateY.value },
      { scale: boardScale.value },
    ],
  }));

  // Persisted (not just in-memory) stacking order: bumping z on every touch
  // and saving it through onLayoutChange means the front/back arrangement
  // survives leaving the screen — a previous version only tracked this in
  // local state, so it silently reset every time the outfit was reopened.
  // Deliberately writes *only* z, never the item's resolved x/y/scale —
  // merely tapping/selecting an item must not freeze whatever position the
  // live auto-grid currently happens to have it at (see CanvasLayout's
  // comment above for why that goes wrong as soon as the outfit changes
  // size). onLayoutChange merges this onto the item's existing saved entry
  // rather than replacing it, so any real saved position survives too.
  function bringToFront(itemId: number) {
    onLayoutChange(itemId, { z: Date.now() });
  }

  const resolved = resolveLayout(items, layout);

  // handleBoardTap needs this render's `resolved`/`selectedId` to hit-test
  // correctly, but boardTap below stays memoized regardless (deps: just
  // isZooming) — refs let the tap handler read the latest values without
  // forcing the gesture itself to be rebuilt on every board re-render (see
  // the comment on boardPinch above for why that rebuilding was the actual
  // freeze bug).
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // Tapping selects the topmost item at that point, same as always — but a
  // second tap in the exact same spot steps to the next item down the stack
  // instead of re-picking the same topmost one. Needed because the tappable
  // box is the full resize square, not just the sticker's visible pixels: a
  // small sticker inside a much bigger (mostly empty) square can otherwise
  // make it impossible to reach whatever's underneath it. Deliberately
  // doesn't bringToFront here — only an actual drag does (via onTouch) —
  // because reordering z on every tap would scramble the stack order
  // mid-cycle, making "next" unpredictable from one tap to the next.
  const handleBoardTap = useCallback((x: number, y: number) => {
    const candidates = resolvedRef.current
      .filter(({ itemLayout }) => {
        const box = boxForItem(itemLayout, displayScale);
        return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      })
      .sort((a, b) => b.zIndex - a.zIndex);

    if (candidates.length === 0) return;

    if (candidates.length === 1) {
      const onlyId = candidates[0].item.id;
      setSelectedId((current) => (current === onlyId ? null : onlyId));
      return;
    }

    const currentIndex = candidates.findIndex(
      (candidate) => candidate.item.id === selectedIdRef.current
    );
    const next =
      currentIndex === -1 || currentIndex === candidates.length - 1
        ? candidates[0]
        : candidates[currentIndex + 1];
    setSelectedId(next.item.id);
  }, [displayScale]);

  const boardTap = useMemo(
    () =>
      Gesture.Tap()
        .enabled(!isZooming)
        .onEnd((event, success) => {
          if (success) runOnJS(handleBoardTap)(event.x, event.y);
        }),
    [isZooming, handleBoardTap]
  );

  const boardGesture = useMemo(
    () => Gesture.Simultaneous(boardZoomGesture, boardTap),
    [boardZoomGesture, boardTap]
  );

  return (
    // The visible bordered frame is sized to the letterboxed board itself
    // (boardWidth/boardHeight), not the full width/height this screen has
    // available — otherwise, whenever the available box is taller than the
    // reference proportions need (e.g. the home screen's board area, which
    // just gets whatever vertical space is left over), the frame stretched
    // to fill all of it while the actual board sat small inside, reading as
    // one big, mostly-empty card instead of a board the right shape for its
    // contents.
    <View style={[styles.canvas, { width: boardWidth, height: boardHeight }]}>
      <GestureDetector gesture={boardGesture}>
        <Animated.View style={[styles.zoomLayer, boardAnimatedStyle]}>
          {items.length === 0 && <Text style={styles.emptyText}>{t('canvas.empty')}</Text>}

          {resolved.map(({ item, itemLayout, zIndex }) => (
            <DraggableItem
              key={item.id}
              item={item}
              layout={itemLayout}
              selected={selectedId === item.id}
              zIndex={zIndex}
              displayScale={displayScale}
              disabled={isZooming}
              onChange={(next) => onLayoutChange(item.id, toFraction(next))}
              onTouch={() => bringToFront(item.id)}
            />
          ))}
        </Animated.View>
      </GestureDetector>

      {priceLabel && (
        <View style={styles.priceTag} pointerEvents="none">
          <Text style={styles.priceTagText}>{priceLabel}</Text>
        </View>
      )}
    </View>
  );
}

export function OutfitPreview({
  items,
  layout,
  size = 172,
  showPrice = false,
}: {
  items: CanvasItem[];
  layout: Record<number, CanvasLayout>;
  size?: number;
  showPrice?: boolean;
}) {
  const { language } = useI18n();
  // `size` is the board's WIDTH, not a square side — height is derived from
  // it using the exact same fixed reference proportions OutfitCanvas uses
  // (see CANVAS_REFERENCE_SIZE and its callers' onLayout handlers). Forcing
  // this into a square box used to letterbox the real 340x420 board down
  // with empty margins on the sides, which put every item at a visibly
  // different spot than the actual editor — this makes it a true scaled-down
  // replica instead, same proportions, same relative positions, no margins.
  const scale = size / CANVAS_REFERENCE_SIZE.width;
  const boardHeight = CANVAS_REFERENCE_SIZE.height * scale;
  const priceLabel = showPrice ? formatPrice(items, language) : null;

  return (
    <View style={[styles.canvas, { width: size, height: boardHeight }]}>
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
        {resolveLayout(items, layout).map(({ item, itemLayout, zIndex }) => (
          <View
            key={item.id}
            style={[
              styles.item,
              {
                zIndex,
                transform: [
                  { translateX: itemLayout.x },
                  { translateY: itemLayout.y },
                  { scale: itemLayout.scale },
                ],
              },
            ]}
          >
            {item.image ? (
              <Image
                source={{ uri: item.image, cacheKey: item.imagePath }}
                style={styles.image}
                contentFit="contain"
              />
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

      {priceLabel && (
        <View style={styles.priceTagCompact} pointerEvents="none">
          <Text style={styles.priceTagCompactText}>{priceLabel}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: VestroColors.frame,
    overflow: 'hidden',
    // Only matters for OutfitPreview below, whose outer box is a fixed
    // size x size square while its inner board (previewInner) is rendered
    // smaller and letterboxed inside it — centering here is what puts that
    // board in the middle of the square instead of pinned to a corner.
    // OutfitCanvas's own box is already sized to its board exactly (see
    // boardWidth/boardHeight there), so this is a no-op for it.
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewInner: {
    overflow: 'hidden',
  },
  zoomLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
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
  priceTag: {
    position: 'absolute',
    // Always above every draggable item, no matter which one was last
    // brought to front (see DraggableItem's zIndex in OutfitCanvas).
    zIndex: PRICE_TAG_Z_INDEX,
    right: 14,
    bottom: 14,
    backgroundColor: VestroColors.surface,
    borderWidth: 1,
    borderColor: VestroColors.border,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  priceTagText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: VestroColors.ink,
  },
  priceTagCompact: {
    position: 'absolute',
    zIndex: PRICE_TAG_Z_INDEX,
    right: 8,
    bottom: 8,
    backgroundColor: VestroColors.surface,
    borderWidth: 1,
    borderColor: VestroColors.border,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  priceTagCompactText: {
    fontFamily: VestroFonts.sansSemiBold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: VestroColors.ink,
  },
});

const HANDLE_POSITION: Record<Corner, object> = {
  topLeft: styles.handle_topLeft,
  topRight: styles.handle_topRight,
  bottomLeft: styles.handle_bottomLeft,
  bottomRight: styles.handle_bottomRight,
};
