import type { CanvasLayout } from '@/components/outfit-canvas';

export type ClothingStatus = 'owned' | 'wishlist';

export type ClothingItem = {
  id: number;
  name: string;
  category: string;
  color?: string;
  image?: string;
  imagePath?: string;
  price?: number;
  status: ClothingStatus;
  available: boolean;
  unavailableReason?: string;
};

export type Outfit = {
  id: number;
  name: string;
  itemIds: number[];
  layout: Record<number, CanvasLayout>;
  showPrice?: boolean;
};

export type ActiveLook = {
  itemIds: number[];
  layout: Record<number, CanvasLayout>;
};
