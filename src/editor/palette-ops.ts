import { EMPTY_VOXEL, PALETTE_SIZE, paletteColor } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';

/** Hue in degrees (0..359), saturation and value in 0..255, as MagicaVoxel's colour sliders show them. */
export type Hsv = Vec3;
/** MagicaVoxel `pal_add`: the channel a delta applies to. */
export const COLOR_CHANNELS = ['h', 's', 'v', 'r', 'g', 'b'] as const;
export type ColorChannel = (typeof COLOR_CHANNELS)[number];

const clampByte = (value: number) => Math.min(Math.max(Math.round(value), 0), 255);

export function rgbToHsv([red, green, blue]: Vec3): Hsv {
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  const sector = delta === 0 ? 0 : max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return [Math.round((sector * 60 + 360) % 360), max === 0 ? 0 : Math.round((delta / max) * 255), max];
}

export function hsvToRgb([hue, saturation, value]: Hsv): Vec3 {
  const chroma = (value / 255) * (saturation / 255);
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const base = value / 255 - chroma;
  const rgb: Vec3 = sector < 1 ? [chroma, second, 0] : sector < 2 ? [second, chroma, 0] : sector < 3 ? [0, chroma, second] : sector < 4 ? [0, second, chroma] : sector < 5 ? [second, 0, chroma] : [chroma, 0, second];
  return [clampByte((rgb[0] + base) * 255), clampByte((rgb[1] + base) * 255), clampByte((rgb[2] + base) * 255)];
}

export const toHex = (rgb: Vec3) => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

/** `#rrggbb` or `rrggbb` (as MagicaVoxel's HEX field takes it), or null. */
export function fromHex(text: string): Vec3 | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** `pal_add`: `rgb` with `delta` added to one HSV or RGB channel (hue wraps around). */
export function adjustColor(rgb: Vec3, channel: ColorChannel, delta: number): Vec3 {
  const rgbIndex = { r: 0, g: 1, b: 2 } as const;
  if (channel === 'r' || channel === 'g' || channel === 'b') {
    const next: Vec3 = [...rgb];
    next[rgbIndex[channel]] = clampByte(rgb[rgbIndex[channel]] + delta);
    return next;
  }
  const [hue, saturation, value] = rgbToHsv(rgb);
  if (channel === 'h') return hsvToRgb([(((hue + delta) % 360) + 360) % 360, saturation, value]);
  if (channel === 's') return hsvToRgb([hue, clampByte(saturation + delta), value]);
  return hsvToRgb([hue, saturation, clampByte(value + delta)]);
}

/** Palette indices from `a` to `b` inclusive, either way round. */
export const indexRange = (a: number, b: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_unused, step) => Math.min(a, b) + step);

/** `pal grad`: the colours between `from` and `to` blended linearly from one end to the other. */
export function gradient(palette: Uint8Array, from: number, to: number): Map<number, Vec3> {
  const start = paletteColor(palette, from);
  const end = paletteColor(palette, to);
  const indices = indexRange(from, to);
  const span = Math.max(indices.length - 1, 1);
  return new Map(
    indices.map((index) => {
      const t = Math.abs(index - from) / span;
      const blend = (channel: 0 | 1 | 2) => clampByte(start[channel] + (end[channel] - start[channel]) * t);
      return [index, [blend(0), blend(1), blend(2)]];
    }),
  );
}

/** Palette indices some voxel of `models` uses. */
export function usedColors(models: VoxModel[]): Set<number> {
  const used = new Set<number>();
  for (const model of models) model.voxels.forEach((color) => color !== EMPTY_VOXEL && used.add(color));
  return used;
}

/** Rewrites every voxel colour through `mapping` (index -> new index); returns the models that changed. */
export function remapVoxels(models: VoxModel[], mapping: Uint8Array): VoxModel[] {
  return models.filter((model) => {
    let changed = false;
    model.voxels.forEach((color, index) => {
      const next = mapping[color];
      if (next === color) return;
      model.voxels[index] = next;
      changed = true;
    });
    return changed;
  });
}

export const identityMapping = () => Uint8Array.from({ length: PALETTE_SIZE }, (_unused, index) => index);

export function invertMapping(mapping: Uint8Array): Uint8Array {
  const inverse = identityMapping();
  mapping.forEach((target, source) => (inverse[target] = source));
  return inverse;
}

/**
 * `pal sort`: the order that arranges `indices` by hue, then from light to dark, grays last.
 * Returns the mapping old index -> new index (identity outside `indices`).
 */
export function sortMapping(palette: Uint8Array, indices: number[]): Uint8Array {
  const key = (index: number) => {
    const [hue, saturation, value] = rgbToHsv(paletteColor(palette, index));
    return [saturation < 16 ? 1 : 0, saturation < 16 ? 0 : hue, -value];
  };
  const sorted = [...indices].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a - b;
  });
  const slots = [...indices].sort((a, b) => a - b);
  const mapping = identityMapping();
  sorted.forEach((index, position) => (mapping[index] = slots[position]));
  return mapping;
}

/** The palette with every colour moved to `mapping[index]` (so voxels remapped the same way look unchanged). */
export function permutePalette(palette: Uint8Array, mapping: Uint8Array): Uint8Array {
  const next = palette.slice();
  for (let index = 1; index < PALETTE_SIZE; index++) next.set(palette.subarray((index - 1) * 4, index * 4), (mapping[index] - 1) * 4);
  return next;
}
