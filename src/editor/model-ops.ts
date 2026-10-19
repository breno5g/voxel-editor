import type { Axis } from '../format/rotation.ts';
import { createModel, EMPTY_VOXEL, MAX_MODEL_SIZE, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { AXES } from './brush-shapes.ts';

/**
 * MagicaVoxel's model edit operations (`config/ui/m_edit.ui`). The binary runs most of them as GPU
 * `map()` passes that fill each destination cell from a source cell; these do the same on the CPU,
 * with cell coordinates instead of the shaders' cell centres. Each returns a new model.
 */

const clampSize = (length: number) => Math.min(Math.max(Math.round(length), 1), MAX_MODEL_SIZE);
const perAxis = (value: (axis: Axis) => number): Vec3 => [value(0), value(1), value(2)];

const colorAt = (model: VoxModel, x: number, y: number, z: number) => {
  const { size } = model;
  if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) return EMPTY_VOXEL;
  return model.voxels[voxelIndex(size, x, y, z)];
};

/** A model of `size` whose every cell takes `sample(cell)`; the cell array is reused between calls. */
function mapCells(size: Vec3, sample: (cell: Vec3) => number): VoxModel {
  const result = createModel(perAxis((axis) => clampSize(size[axis])));
  const [width, depth, height] = result.size;
  const cell: Vec3 = [0, 0, 0];
  let index = 0;
  for (let z = 0; z < height; z++) {
    for (let y = 0; y < depth; y++) {
      for (let x = 0; x < width; x++) {
        cell[0] = x;
        cell[1] = y;
        cell[2] = z;
        result.voxels[index++] = sample(cell);
      }
    }
  }
  return result;
}

const sampleAt = (model: VoxModel, cell: Vec3) => colorAt(model, Math.floor(cell[0]), Math.floor(cell[1]), Math.floor(cell[2]));
/** The two axes other than `axis`, in MagicaVoxel's cyclic order (`axis.zxy`, `axis.yzx`). */
const crossAxes = (axis: Axis): [Axis, Axis] => [AXES[(axis + 1) % 3], AXES[(axis + 2) % 3]];

/** `rev`: swaps filled and empty cells, filling with `color`. */
export const reverse = (model: VoxModel, color: number) =>
  mapCells(model.size, ([x, y, z]) => (colorAt(model, x, y, z) === EMPTY_VOXEL ? color : EMPTY_VOXEL));

/** `x2`: twice the size, each voxel becoming a 2×2×2 block. */
export const double = (model: VoxModel) =>
  mapCells([model.size[0] * 2, model.size[1] * 2, model.size[2] * 2], ([x, y, z]) => colorAt(model, x >> 1, y >> 1, z >> 1));

const HALF_BLOCK: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

/** `xh`: half the size (rounded up); each 2×2×2 block keeps its first filled voxel, in MagicaVoxel's order. */
export const half = (model: VoxModel) =>
  mapCells(
    perAxis((axis) => Math.ceil(model.size[axis] / 2)),
    ([x, y, z]) => HALF_BLOCK.map(([dx, dy, dz]) => colorAt(model, x * 2 + dx, y * 2 + dy, z * 2 + dz)).find((color) => color !== EMPTY_VOXEL) ?? EMPTY_VOXEL,
  );

/** `flip x|y|z`: mirrors the volume along `axis`. */
export const flip = (model: VoxModel, axis: Axis) =>
  mapCells(model.size, (cell) => {
    cell[axis] = model.size[axis] - 1 - cell[axis];
    return sampleAt(model, cell);
  });

/** `loop`: moves the content by `offset` cells, wrapping around the volume. */
export const loop = (model: VoxModel, offset: Vec3) =>
  mapCells(model.size, (cell) => {
    for (const axis of AXES) cell[axis] = (((cell[axis] - offset[axis]) % model.size[axis]) + model.size[axis]) % model.size[axis];
    return sampleAt(model, cell);
  });

/**
 * `rot90 x|y|z`: a quarter turn of the volume around `axis`, swapping the size of the other two axes.
 * With `(s, t)` the cross axes, destination `(s, t)` reads source `(t, size_s - 1 - s)`.
 */
export function rotate90(model: VoxModel, axis: Axis): VoxModel {
  const [s, t] = crossAxes(axis);
  const size: Vec3 = [...model.size];
  size[s] = model.size[t];
  size[t] = model.size[s];
  return mapCells(size, (cell) => {
    const source: Vec3 = [cell[0], cell[1], cell[2]];
    source[s] = cell[t];
    source[t] = size[s] - 1 - cell[s];
    return sampleAt(model, source);
  });
}

/** `mir x|y|z`: the lower half along `axis` is mirrored onto the upper half. */
export const mirror = (model: VoxModel, axis: Axis) =>
  mapCells(model.size, (cell) => {
    const reflected = model.size[axis] - 1 - cell[axis];
    if (reflected < cell[axis]) cell[axis] = reflected;
    return sampleAt(model, cell);
  });

/**
 * `dia x|y|z`: mirrors across the diagonal plane of the two cross axes: cells where the first
 * cross coordinate is below the second copy the transposed cell (empty when it falls outside).
 */
export function diagonal(model: VoxModel, axis: Axis): VoxModel {
  const [s, t] = crossAxes(axis);
  return mapCells(model.size, (cell) => {
    if (cell[s] < cell[t]) [cell[s], cell[t]] = [cell[t], cell[s]];
    return sampleAt(model, cell);
  });
}

/** `scale`: nearest-neighbour scaling by `factors` per axis (sizes rounded, 1–256). */
export const scale = (model: VoxModel, factors: Vec3) =>
  mapCells(
    perAxis((axis) => model.size[axis] * factors[axis]),
    (cell) => sampleAt(model, [(cell[0] + 0.5) / factors[0], (cell[1] + 0.5) / factors[1], (cell[2] + 0.5) / factors[2]]),
  );

/** `shear axis a b`: each layer along `axis` shifts by its depth times `amounts` on the two cross axes. */
export function shear(model: VoxModel, axis: Axis, amounts: [number, number]): VoxModel {
  const [s, t] = crossAxes(axis);
  const [along, across] = s < t ? [s, t] : [t, s];
  return mapCells(model.size, (cell) => {
    const depth = cell[axis];
    const source: Vec3 = [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5];
    source[along] -= depth * amounts[0];
    source[across] -= depth * amounts[1];
    return sampleAt(model, source);
  });
}

/** `rot axis angle`: turns the content by `degrees` around `axis`; the volume grows to fit it (nearest sampling). */
export function rotate(model: VoxModel, axis: Axis, degrees: number): VoxModel {
  const [s, t] = crossAxes(axis);
  const radians = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  const size: Vec3 = [...model.size];
  size[s] = Math.ceil(Math.abs(cos) * model.size[s] + Math.abs(sin) * model.size[t] - 1e-6);
  size[t] = Math.ceil(Math.abs(sin) * model.size[s] + Math.abs(cos) * model.size[t] - 1e-6);
  const target = size.map(clampSize);
  return mapCells(size, (cell) => {
    const ds = cell[s] + 0.5 - target[s] / 2;
    const dt = cell[t] + 0.5 - target[t] / 2;
    const source: Vec3 = [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5];
    source[s] = cos * ds + sin * dt + model.size[s] / 2;
    source[t] = -sin * ds + cos * dt + model.size[t] / 2;
    return sampleAt(model, source);
  });
}

/** `repeat`: tiles the model `counts` times per axis. */
export const repeat = (model: VoxModel, counts: Vec3) =>
  mapCells(perAxis((axis) => model.size[axis] * counts[axis]), ([x, y, z]) =>
    colorAt(model, x % model.size[0], y % model.size[1], z % model.size[2]),
  );

const FACE_OFFSETS: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** How far `dil`/`ero` look along an axis: both ways (the default), only one way, or not at all. */
export type AxisReach = 'both' | 'positive' | 'negative' | 'none';
const REACH_RANGE: Record<AxisReach, [number, number]> = { both: [-1, 1], positive: [0, 1], negative: [-1, 0], none: [0, 0] };
export const ALL_NEIGHBORS: [AxisReach, AxisReach, AxisReach] = ['both', 'both', 'both'];

/** Every neighbour offset within the per-axis reach, the zero offset excluded (26 by default), like `***REMOVED***`. */
export function neighborOffsets(reach: readonly AxisReach[]): Vec3[] {
  const [[x0, x1], [y0, y1], [z0, z1]] = AXES.map((axis) => REACH_RANGE[reach[axis]]);
  const offsets: Vec3[] = [];
  for (let dz = z0; dz <= z1; dz++) for (let dy = y0; dy <= y1; dy++) for (let dx = x0; dx <= x1; dx++) if (dx || dy || dz) offsets.push([dx, dy, dz]);
  return offsets;
}

/** `dil`: empty cells next to a filled one take `color`. */
export function dilate(model: VoxModel, color: number, reach: readonly AxisReach[] = ALL_NEIGHBORS): VoxModel {
  const offsets = neighborOffsets(reach);
  return mapCells(model.size, ([x, y, z]) => {
    const current = colorAt(model, x, y, z);
    if (current !== EMPTY_VOXEL) return current;
    return offsets.some(([dx, dy, dz]) => colorAt(model, x + dx, y + dy, z + dz) !== EMPTY_VOXEL) ? color : EMPTY_VOXEL;
  });
}

/** `ero`: filled cells next to an empty cell or the outside are removed. */
export function erode(model: VoxModel, reach: readonly AxisReach[] = ALL_NEIGHBORS): VoxModel {
  const offsets = neighborOffsets(reach);
  return mapCells(model.size, ([x, y, z]) => {
    const current = colorAt(model, x, y, z);
    if (current === EMPTY_VOXEL) return current;
    return offsets.some(([dx, dy, dz]) => colorAt(model, x + dx, y + dy, z + dz) === EMPTY_VOXEL) ? EMPTY_VOXEL : current;
  });
}

/** Empty cells connected by faces to the outside of the volume. */
function outsideSpace(model: VoxModel): Uint8Array {
  const { size, voxels } = model;
  const outside = new Uint8Array(voxels.length);
  const stack: number[] = [];
  const visit = (x: number, y: number, z: number) => {
    const index = voxelIndex(size, x, y, z);
    if (outside[index] || voxels[index] !== EMPTY_VOXEL) return;
    outside[index] = 1;
    stack.push(index);
  };
  const [width, depth, height] = size;
  for (let z = 0; z < height; z++) {
    for (let y = 0; y < depth; y++) {
      for (let x = 0; x < width; x++) {
        if (x === 0 || y === 0 || z === 0 || x === width - 1 || y === depth - 1 || z === height - 1) visit(x, y, z);
      }
    }
  }
  while (stack.length > 0) {
    const index = stack.pop() ?? 0;
    const x = index % width;
    const y = Math.floor(index / width) % depth;
    const z = Math.floor(index / (width * depth));
    for (const [dx, dy, dz] of FACE_OFFSETS) {
      const [nx, ny, nz] = [x + dx, y + dy, z + dz];
      if (nx >= 0 && ny >= 0 && nz >= 0 && nx < width && ny < depth && nz < height) visit(nx, ny, nz);
    }
  }
  return outside;
}

/** `flood 0` (Hull): removes every voxel without a face toward the outside space. */
export function hull(model: VoxModel): VoxModel {
  const outside = outsideSpace(model);
  const { size } = model;
  const isOutside = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2] || outside[voxelIndex(size, x, y, z)] === 1;
  return mapCells(size, ([x, y, z]) => {
    const current = colorAt(model, x, y, z);
    if (current === EMPTY_VOXEL) return current;
    return FACE_OFFSETS.some(([dx, dy, dz]) => isOutside(x + dx, y + dy, z + dz)) ? current : EMPTY_VOXEL;
  });
}

/** `flood` (Flood): fills every enclosed empty cell, unreachable from the outside, with `color`. */
export function flood(model: VoxModel, color: number): VoxModel {
  const outside = outsideSpace(model);
  const result = createModel(model.size);
  model.voxels.forEach((current, index) => {
    result.voxels[index] = current === EMPTY_VOXEL && !outside[index] ? color : current;
  });
  return result;
}

export const PRIMITIVES = ['elli', 'cyli', 'pyra', 'cone'] as const;
export type Primitive = (typeof PRIMITIVES)[number];

/** Each primitive's test on the cell centre mapped to [-1, 1] on x/y and [0, 1] on z. */
const PRIMITIVE_TESTS: Record<Primitive, (x: number, y: number, z: number) => boolean> = {
  elli: (x, y, z) => x * x + y * y + (z * 2 - 1) ** 2 <= 1,
  cyli: (x, y) => x * x + y * y <= 1,
  cone: (x, y, z) => x * x + y * y <= (1 - z) ** 2,
  pyra: (x, y, z) => Math.abs(x) + z <= 1 && Math.abs(y) + z <= 1,
};

/** `prim elli|cyli|pyra|cone`: replaces the volume with the shape inscribed in it, in `color`. */
export const primitive = (model: VoxModel, shape: Primitive, color: number) =>
  mapCells(model.size, ([x, y, z]) => {
    const [u, v, w] = [((x + 0.5) / model.size[0]) * 2 - 1, ((y + 0.5) / model.size[1]) * 2 - 1, (z + 0.5) / model.size[2]];
    return PRIMITIVE_TESTS[shape](u, v, w) ? color : EMPTY_VOXEL;
  });

/** Ken Perlin's reference permutation, which MagicaVoxel's noise (`***REMOVED***`) uses. */
const PERMUTATION = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234,
  75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139,
  48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80,
  73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202,
  38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221,
  153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238,
  210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4,
  150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];
/** The binary's gradient table (`***REMOVED***`), indexed by the low four bits of the hash. */
const GRADIENTS: Vec3[] = [
  [0, 1, 1], [0, 1, -1], [0, -1, -1], [0, -1, 1], [1, 0, 1], [1, 0, -1], [-1, 0, -1], [-1, 0, 1],
  [1, 1, 0], [-1, 1, 0], [-1, -1, 0], [1, -1, 0], [0, 1, 1], [0, 1, -1], [0, -1, -1], [0, -1, 1],
];

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const permuted = (index: number) => PERMUTATION[index & 255];

/** Improved Perlin noise in roughly [-1, 1]. */
export function perlin(x: number, y: number, z: number): number {
  const [cellX, cellY, cellZ] = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const [u, v, w] = [x - cellX, y - cellY, z - cellZ];
  const corner = (dx: number, dy: number, dz: number) => {
    const hash = permuted(permuted(permuted(cellX + dx) + cellY + dy) + cellZ + dz) & 15;
    const [gx, gy, gz] = GRADIENTS[hash];
    return gx * (u - dx) + gy * (v - dy) + gz * (w - dz);
  };
  const [fu, fv, fw] = [fade(u), fade(v), fade(w)];
  const near = lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), fu), lerp(corner(0, 1, 0), corner(1, 1, 0), fu), fv);
  const far = lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), fu), lerp(corner(0, 1, 1), corner(1, 1, 1), fu), fv);
  return lerp(near, far, fw);
}

/** `noise seed frequency low high`; MagicaVoxel's defaults, with `-1` drawing a random seed. */
export type NoiseOptions = { seed: number; frequency: number; low: number; high: number };
export const DEFAULT_NOISE: Omit<NoiseOptions, 'seed'> = { frequency: 0.04, low: 0.2, high: 0.5 };

/** `noise`: replaces the volume with the cells whose `sin(π · perlin((cell + seed) · frequency))` lies in (low, high). */
export const noise = (model: VoxModel, color: number, { seed, frequency, low, high }: NoiseOptions) =>
  mapCells(model.size, ([x, y, z]) => {
    const value = Math.sin(Math.PI * perlin((x + seed) * frequency, (y + seed) * frequency, (z + seed) * frequency));
    return value > low && value < high ? color : EMPTY_VOXEL;
  });

/** A C `rand()`-like integer in [0, 32768) from a [0, 1) source. */
const randomInt = (random: () => number) => Math.floor(random() * 32768);

/**
 * `maze width` (`***REMOVED***`): a growing-tree maze of one-voxel corridors on a lattice with
 * `width + 2` cells between nodes, in 3D when the volume is deep enough. Each step continues from the
 * newest node or a random one, preferring the -x/-y/-z neighbours four times in five, like the binary.
 */
export function maze(model: VoxModel, color: number, width = 1, random: () => number = Math.random): VoxModel {
  const result = createModel(model.size);
  const period = Math.max(1, width) + 2;
  const nodes = perAxis((axis) => Math.floor((model.size[axis] - 1) / period) + 1);
  const nodeIndex = ([x, y, z]: Vec3) => x + nodes[0] * (y + nodes[1] * z);
  const visited = new Uint8Array(nodes[0] * nodes[1] * nodes[2]);
  const paint = (cell: Vec3) => (result.voxels[voxelIndex(model.size, cell[0], cell[1], cell[2])] = color);
  const start = perAxis((axis) => randomInt(random) % nodes[axis]);
  visited[nodeIndex(start)] = 1;
  paint(perAxis((axis) => start[axis] * period));
  const active: Vec3[] = [start];
  const unvisited = (node: Vec3, axis: Axis, step: number) => {
    const next: Vec3 = [node[0], node[1], node[2]];
    next[axis] += step;
    return next[axis] >= 0 && next[axis] < nodes[axis] && !visited[nodeIndex(next)];
  };
  while (active.length > 0) {
    const pick = randomInt(random) & 1 ? active.length - 1 : randomInt(random) % active.length;
    const node = active[pick];
    let moves: [Axis, number][] = AXES.filter((axis) => unvisited(node, axis, -1)).map((axis) => [axis, -1]);
    if (moves.length === 0 || randomInt(random) % 5 === 0) moves = [...moves, ...AXES.filter((axis) => unvisited(node, axis, 1)).map((axis): [Axis, number] => [axis, 1])];
    if (moves.length === 0) {
      active[pick] = active[active.length - 1];
      active.pop();
      continue;
    }
    const [axis, step] = moves[randomInt(random) % moves.length];
    const next: Vec3 = [node[0], node[1], node[2]];
    next[axis] += step;
    visited[nodeIndex(next)] = 1;
    active.push(next);
    const corridor = perAxis((other) => node[other] * period);
    for (let walked = 0; walked < period; walked++) {
      corridor[axis] += step;
      paint(corridor);
    }
  }
  return result;
}

/**
 * Wrap transform (`b_xform wrap`): copies of the model along `axis`, `spacing` empty cells apart,
 * filling `length` cells; `phase` shifts where the first whole copy starts.
 */
export function tile(model: VoxModel, axis: Axis, length: number, spacing: number, phase = 0): VoxModel {
  const size: Vec3 = [...model.size];
  size[axis] = length;
  const period = model.size[axis] + Math.max(0, spacing);
  return mapCells(size, (cell) => {
    const along = (((cell[axis] - phase) % period) + period) % period;
    if (along >= model.size[axis]) return EMPTY_VOXEL;
    cell[axis] = along;
    return sampleAt(model, cell);
  });
}

/** The pattern colour tiled over cell `[x, y, z]` (its size repeating along every axis), or empty. */
const tiledColor = (pattern: VoxModel, [x, y, z]: Vec3) => {
  const [px, py, pz] = pattern.size;
  return pattern.voxels[voxelIndex(pattern.size, x % px, y % py, z % pz)];
};

/**
 * MagicaVoxel `fractal`: every voxel of the model becomes a copy of the pattern in that voxel's colour,
 * so the result is the model's size times the pattern's (at most 256 per axis).
 */
export function fractal(model: VoxModel, pattern: VoxModel): VoxModel {
  const [px, py, pz] = pattern.size;
  return mapCells(perAxis((axis) => model.size[axis] * pattern.size[axis]), (cell) => {
    const color = model.voxels[voxelIndex(model.size, Math.floor(cell[0] / px), Math.floor(cell[1] / py), Math.floor(cell[2] / pz))];
    return color !== EMPTY_VOXEL && tiledColor(pattern, cell) !== EMPTY_VOXEL ? color : EMPTY_VOXEL;
  });
}

/** MagicaVoxel `mask`: keeps only the voxels where the pattern, tiled over the volume, has one. */
export const mask = (model: VoxModel, pattern: VoxModel): VoxModel =>
  mapCells(model.size, (cell) => (tiledColor(pattern, cell) !== EMPTY_VOXEL ? colorAt(model, cell[0], cell[1], cell[2]) : EMPTY_VOXEL));

/** MagicaVoxel `tex`: recolours the voxels with the pattern tiled over the volume, where the pattern has a voxel. */
export const texture = (model: VoxModel, pattern: VoxModel): VoxModel =>
  mapCells(model.size, (cell) => {
    const color = colorAt(model, cell[0], cell[1], cell[2]);
    const tile = tiledColor(pattern, cell);
    return color !== EMPTY_VOXEL && tile !== EMPTY_VOXEL ? tile : color;
  });
