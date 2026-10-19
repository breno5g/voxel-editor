import { createModel, IDENTITY_ROTATION, NO_LAYER, PALETTE_BYTES } from './vox.ts';
import type { SceneNode, TransformNode, Vec3, VoxDocument } from './vox.ts';

export const DEFAULT_MODEL_SIZE: Vec3 = [32, 32, 32];

/** MagicaVoxel's default palette: a 6×6×6 cube from white down (black left out), then red, green, blue and gray ramps. */
const CUBE_LEVELS = [0xff, 0xcc, 0x99, 0x66, 0x33, 0x00];
const RAMP_LEVELS = [0xee, 0xdd, 0xbb, 0xaa, 0x88, 0x77, 0x55, 0x44, 0x22, 0x11];
const PALETTE_HUES = 32;
const PALETTE_SHADES = 7;
const PALETTE_GRAYS = 255 - PALETTE_HUES * PALETTE_SHADES;

/** Object transform that rests the model on the ground plane (z = 0). */
export function objectTransform(child: number, size: Vec3): TransformNode {
  return {
    kind: 'transform',
    attrs: new Map(),
    child,
    layer: 0,
    keys: [{ frame: 0, translation: [0, 0, Math.floor(size[2] / 2)], rotation: IDENTITY_ROTATION }],
  };
}

/** Root transform -> group -> one transform + shape per model, as MagicaVoxel lays it out. */
export function buildScene(sizes: Vec3[]): SceneNode[] {
  const objects = sizes.flatMap((size, model): SceneNode[] => [
    objectTransform(3 + model * 2, size),
    { kind: 'shape', attrs: new Map(), keys: [{ frame: 0, model }] },
  ]);
  return [
    { kind: 'transform', attrs: new Map(), child: 1, layer: NO_LAYER, keys: [{ frame: 0, translation: [0, 0, 0], rotation: IDENTITY_ROTATION }] },
    { kind: 'group', attrs: new Map(), children: sizes.map((_size, model) => 2 + model * 2) },
    ...objects,
  ];
}

/** MagicaVoxel's `pal0`, used whenever a file has no RGBA chunk. */
export function createDefaultPalette(): Uint8Array {
  const cube = CUBE_LEVELS.flatMap((red) => CUBE_LEVELS.flatMap((green) => CUBE_LEVELS.map((blue): Vec3 => [red, green, blue]))).filter((rgb) => rgb.some(Boolean));
  const ramps = [(v: number): Vec3 => [v, 0, 0], (v: number): Vec3 => [0, v, 0], (v: number): Vec3 => [0, 0, v], (v: number): Vec3 => [v, v, v]].flatMap((ramp) => RAMP_LEVELS.map(ramp));
  const palette = new Uint8Array(PALETTE_BYTES);
  [...cube, ...ramps].forEach((rgb, slot) => palette.set([...rgb, 255], slot * 4));
  return palette;
}

/** This editor's earlier palette: 7 shades of 32 hues followed by a gray ramp. */
export function createHuePalette(): Uint8Array {
  const palette = new Uint8Array(PALETTE_BYTES);
  for (let slot = 0; slot < 255; slot++) {
    const grayLevel = (slot - PALETTE_HUES * PALETTE_SHADES) / (PALETTE_GRAYS - 1);
    const rgb = slot < PALETTE_HUES * PALETTE_SHADES
      ? hslToRgb((slot % PALETTE_HUES) / PALETTE_HUES, 0.7, 0.2 + 0.1 * Math.floor(slot / PALETTE_HUES))
      : [grayLevel, grayLevel, grayLevel];
    palette.set([...rgb.map((channel) => Math.round(channel * 255)), 255], slot * 4);
  }
  return palette;
}

function hslToRgb(hue: number, saturation: number, lightness: number): Vec3 {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const channel = (shift: number) => {
    const k = (shift + hue * 12) % 12;
    return lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

export function createDocument(size: Vec3 = DEFAULT_MODEL_SIZE): VoxDocument {
  return {
    models: [createModel(size)],
    nodes: buildScene([size]),
    palette: createDefaultPalette(),
    layers: [],
    meta: new Map(),
    extras: [],
  };
}
