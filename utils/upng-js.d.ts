declare module 'upng-js' {
  export type UPNGImage = {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: unknown[];
    tabs: Record<string, unknown>;
    data: Uint8Array;
  };

  export function decode(buffer: ArrayBufferLike): UPNGImage;
  export function toRGBA8(img: UPNGImage): ArrayBufferLike[];
  export function encode(
    frames: ArrayBufferLike[],
    width: number,
    height: number,
    colorsCount: number
  ): ArrayBufferLike;
}
