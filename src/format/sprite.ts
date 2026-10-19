import { createDefaultPalette } from './defaults.ts';
import { createModel, MAX_MODEL_SIZE, PALETTE_SIZE, voxelIndex } from './vox.ts';
import type { VoxModel } from './vox.ts';

/** Pixels at least this opaque become voxels. */
const OPAQUE = 128;

/** The palette index (1..255) closest to an RGB colour. */
export function nearestColor(palette: Uint8Array, red: number, green: number, blue: number): number {
  let best = 1;
  let bestDistance = Infinity;
  for (let index = 1; index < PALETTE_SIZE; index++) {
    const offset = (index - 1) * 4;
    const distance = (palette[offset] - red) ** 2 + (palette[offset + 1] - green) ** 2 + (palette[offset + 2] - blue) ** 2;
    if (distance < bestDistance) [best, bestDistance] = [index, distance];
  }
  return best;
}

/**
 * MagicaVoxel sprite import: an image standing upright in the x-z plane, one voxel deep, its top row
 * at the top. Each opaque pixel takes the nearest palette colour; images past 256 pixels are cropped.
 */
export function spriteModel(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, palette: Uint8Array): VoxModel {
  const size: [number, number, number] = [Math.min(width, MAX_MODEL_SIZE), 1, Math.min(height, MAX_MODEL_SIZE)];
  const model = createModel(size);
  const cache = new Map<number, number>();
  for (let y = 0; y < size[2]; y++) {
    for (let x = 0; x < size[0]; x++) {
      const offset = (y * width + x) * 4;
      if (rgba[offset + 3] < OPAQUE) continue;
      const key = (rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2];
      let color = cache.get(key);
      if (color === undefined) cache.set(key, (color = nearestColor(palette, rgba[offset], rgba[offset + 1], rgba[offset + 2])));
      model.voxels[voxelIndex(size, x, 0, size[2] - 1 - y)] = color;
    }
  }
  return model;
}

/**
 * A palette for imported true-colour voxels: the colours themselves when there are at most 255,
 * else the 255 most frequent, every other colour taking its nearest one.
 */
export function paletteFromColors(colors: [number, number, number][]): { palette: Uint8Array; indexOf: (rgb: [number, number, number]) => number } {
  const counts = new Map<number, number>();
  for (const [red, green, blue] of colors) {
    const key = (red << 16) | (green << 8) | blue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const kept = [...counts].sort((a, b) => b[1] - a[1]).slice(0, PALETTE_SIZE - 1).map(([key]) => key);
  const palette = createDefaultPalette();
  kept.forEach((key, slot) => palette.set([(key >> 16) & 255, (key >> 8) & 255, key & 255, 255], slot * 4));
  const exact = new Map(kept.map((key, slot) => [key, slot + 1]));
  return {
    palette,
    indexOf: ([red, green, blue]) => exact.get((red << 16) | (green << 8) | blue) ?? nearestColor(palette, red, green, blue),
  };
}
