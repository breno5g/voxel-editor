import { EMPTY_VOXEL, paletteColor, voxelIndex } from './vox.ts';
import type { Vec3, VoxModel } from './vox.ts';

/** An RGBA image, ready for `ImageData`. */
export type RgbaImage = { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> };

export type IsoOptions = { size: number; height: number; views: number; outline: boolean; top: Vec3; left: Vec3; right: Vec3 };
/** `config.txt` `io_iso`: voxel size, side height, number of views, outline, and per-face lighting. */
export const ISO_OPTIONS: IsoOptions = { size: 2, height: 4, views: 4, outline: true, top: [1.17, 1.15, 1.25], left: [0.37, 0.35, 0.55], right: [0.87, 0.85, 0.95] };
/** `config.txt` `io_2d`: pixels per voxel, shadow, outline. */
export const FLAT_OPTIONS = { size: 16, shadow: true, outline: false } as const;

const createImage = (width: number, height: number): RgbaImage => ({ width, height, pixels: new Uint8ClampedArray(width * height * 4) });

const put = (image: RgbaImage, x: number, y: number, rgb: readonly number[], alpha = 255) => {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  image.pixels.set([rgb[0], rgb[1], rgb[2], alpha], (y * image.width + x) * 4);
};

/** MagicaVoxel `slice`: one top-down image per z layer, left to right, +y up. */
export function sliceImage(model: VoxModel, palette: Uint8Array): RgbaImage {
  const [sx, sy, sz] = model.size;
  const image = createImage(sx * sz, sy);
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const color = model.voxels[voxelIndex(model.size, x, y, z)];
        if (color !== EMPTY_VOXEL) put(image, z * sx + x, sy - 1 - y, paletteColor(palette, color));
      }
    }
  }
  return image;
}

/** MagicaVoxel `2d`: the front view (looking along +y), `size` pixels per voxel; deeper voxels darker with `shadow`. */
export function flatImage(model: VoxModel, palette: Uint8Array, options: { size: number; shadow: boolean; outline: boolean } = FLAT_OPTIONS): RgbaImage {
  const [sx, sy, sz] = model.size;
  const depth = new Int16Array(sx * sz).fill(-1);
  const colors = new Uint8Array(sx * sz);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      for (let y = 0; y < sy; y++) {
        const color = model.voxels[voxelIndex(model.size, x, y, z)];
        if (color === EMPTY_VOXEL) continue;
        depth[x + z * sx] = y;
        colors[x + z * sx] = color;
        break;
      }
    }
  }
  const { size } = options;
  const image = createImage(sx * size, sz * size);
  const depthAt = (x: number, z: number) => (x < 0 || z < 0 || x >= sx || z >= sz ? -1 : depth[x + z * sx]);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const near = depthAt(x, z);
      if (near < 0) continue;
      const shade = options.shadow ? 1 - (0.5 * near) / Math.max(sy, 1) : 1;
      const rgb = paletteColor(palette, colors[x + z * sx]).map((channel) => channel * shade);
      const edges = options.outline ? [depthAt(x - 1, z), depthAt(x + 1, z), depthAt(x, z - 1), depthAt(x, z + 1)].map((other) => other < 0 || other > near) : [false, false, false, false];
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const onEdge = (edges[0] && px === 0) || (edges[1] && px === size - 1) || (edges[2] && py === size - 1) || (edges[3] && py === 0);
          put(image, x * size + px, (sz - 1 - z) * size + py, onEdge ? rgb.map((channel) => channel * 0.4) : rgb);
        }
      }
    }
  }
  return image;
}

/** The model turned `quarter` quarter turns about z, for the iso export's other views. */
function turned(model: VoxModel, quarter: number): VoxModel {
  let current = model;
  for (let step = 0; step < quarter; step++) {
    const [sx, sy, sz] = current.size;
    const next: VoxModel = { size: [sy, sx, sz], voxels: new Uint8Array(current.voxels.length) };
    current.voxels.forEach((color, index) => {
      const [x, y, z] = [index % sx, Math.floor(index / sx) % sy, Math.floor(index / (sx * sy))];
      next.voxels[voxelIndex(next.size, sy - 1 - y, x, z)] = color;
    });
    current = next;
  }
  return current;
}

/**
 * MagicaVoxel `iso`: pixel-art isometric cubes (2:1), drawn back to front with the `io_iso` lighting on
 * the top, left and right faces and an optional dark outline; `views` turns side by side.
 */
export function isoImage(model: VoxModel, palette: Uint8Array, options: IsoOptions = ISO_OPTIONS): RgbaImage {
  const half = options.size * 2;
  const quarter = options.size;
  const side = options.height;
  const views = Array.from({ length: options.views }, (_unused, view) => turned(model, view));
  const extent = (current: VoxModel) => {
    const [sx, sy, sz] = current.size;
    return { width: (sx + sy) * half, height: (sx + sy) * quarter + sz * side + quarter * 2 };
  };
  const sizes = views.map(extent);
  const image = createImage(sizes.reduce((total, size) => total + size.width + half, 0), Math.max(...sizes.map((size) => size.height)));
  let left = 0;
  views.forEach((current, view) => {
    const [sx, sy, sz] = current.size;
    const origin: [number, number] = [left + sy * half, image.height - sz * side - (sx + sy) * quarter - quarter];
    const cells: Vec3[] = [];
    current.voxels.forEach((color, index) => color !== EMPTY_VOXEL && cells.push([index % sx, Math.floor(index / sx) % sy, Math.floor(index / (sx * sy))]));
    cells.sort((a, b) => a[2] - b[2] || b[0] + b[1] - (a[0] + a[1]) || a[0] - b[0]);
    for (const [x, y, z] of cells) {
      const rgb = paletteColor(palette, current.voxels[voxelIndex(current.size, x, y, z)]);
      const lit = (light: readonly number[]) => rgb.map((channel, index) => Math.min(channel * light[index], 255));
      const centerX = origin[0] + (x - y) * half;
      const topY = origin[1] + (sx - 1 - x + sy - 1 - y) * quarter + (sz - 1 - z) * side;
      for (let dy = 0; dy < quarter * 2 + side; dy++) {
        for (let dx = -half; dx < half; dx++) {
          const fromCenter = Math.abs(dx + 0.5);
          const onTop = dy < quarter * 2 && fromCenter <= half - Math.abs(dy + 0.5 - quarter) * 2;
          const sideTop = quarter * 2 - fromCenter / 2;
          const onSide = dy >= sideTop && dy < sideTop + side;
          if (!onTop && !onSide) continue;
          const light = onTop ? options.top : dx < 0 ? options.left : options.right;
          put(image, centerX + dx, topY + dy, lit(light));
        }
      }
    }
    if (options.outline) outline(image, left, sizes[view].width);
    left += sizes[view].width + half;
  });
  return image;
}

/** Darkens transparent pixels next to drawn ones within columns [from, from + width). */
function outline(image: RgbaImage, from: number, width: number) {
  const alphaAt = (x: number, y: number) => (x < 0 || y < 0 || x >= image.width || y >= image.height ? 0 : image.pixels[(y * image.width + x) * 4 + 3]);
  const edges: [number, number][] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = from; x < from + width; x++) {
      if (alphaAt(x, y) === 0 && [alphaAt(x - 1, y), alphaAt(x + 1, y), alphaAt(x, y - 1), alphaAt(x, y + 1)].some(Boolean)) edges.push([x, y]);
    }
  }
  edges.forEach(([x, y]) => put(image, x, y, [24, 22, 30]));
}
