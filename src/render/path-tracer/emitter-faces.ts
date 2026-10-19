import type { Vec3 } from '../../format/vox.ts';
import type { SceneVolume } from './scene-volume.ts';

/** Face directions, negative before positive per axis: an odd face lies on the cell's far side. */
export const FACE_NORMALS: readonly Vec3[] = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
const PALETTE_INDICES = 256;
const GROUPS = PALETTE_INDICES * FACE_NORMALS.length;

/**
 * Every face light can leave an area-light voxel by, grouped by palette index and direction like
 * MagicaVoxel's emitter list: `cells` holds linear cell indices, group `index·6 + face` spans
 * `offsets[group]` up to `offsets[group + 1]`.
 */
export type EmitterFaces = { cells: Uint32Array; offsets: Uint32Array };

/**
 * The faces of voxels whose index `emits` that border an empty cell or one light crosses (`clear`).
 * `emits` and `clear` are flags per palette index.
 */
export function collectEmitterFaces({ size, voxels }: SceneVolume, emits: Uint8Array, clear: Uint8Array): EmitterFaces {
  const offsets = new Uint32Array(GROUPS + 1);
  if (!emits.some((flag) => flag !== 0)) return { cells: new Uint32Array(0), offsets };
  const [sx, sy, sz] = size;
  const strides = [1, sx, sx * sy];
  const bounds = [sx, sy, sz];
  /* The grid has an empty margin, so a face on its edge borders nothing: it counts as open. */
  const open = (cell: number, coordinate: number[], face: number) => {
    const axis = face >> 1;
    const step = face & 1 ? 1 : -1;
    const next = coordinate[axis] + step;
    if (next < 0 || next >= bounds[axis]) return true;
    const neighbour = voxels[cell + step * strides[axis]];
    return neighbour === 0 || clear[neighbour] !== 0;
  };
  // ponytail: two full scans of the grid, only when the palette has an area light; skip empty bricks if large scenes stall.
  const visit = (each: (group: number, cell: number) => void) => {
    let cell = 0;
    for (let z = 0; z < sz; z++) {
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++, cell++) {
          const color = voxels[cell];
          if (color === 0 || emits[color] === 0) continue;
          const coordinate = [x, y, z];
          for (let face = 0; face < FACE_NORMALS.length; face++) if (open(cell, coordinate, face)) each(color * FACE_NORMALS.length + face, cell);
        }
      }
    }
  };
  visit((group) => offsets[group + 1]++);
  for (let group = 0; group < GROUPS; group++) offsets[group + 1] += offsets[group];
  const cells = new Uint32Array(offsets[GROUPS]);
  const filled = offsets.slice(0, GROUPS);
  visit((group, cell) => (cells[filled[group]++] = cell));
  return { cells, offsets };
}

/** World area of a face in direction `face` of a cell scaled by `scale`. */
const faceArea = (face: number, [x, y, z]: Vec3) => [y * z, x * z, x * y][face >> 1];

/**
 * Running total of each group's power (faces · brightest channel of its radiance · face area), as
 * MagicaVoxel's ***REMOVED*** sums it; `radiance` is linear RGB per palette index.
 */
export function emitterPower({ offsets }: EmitterFaces, radiance: Float32Array, scale: Vec3): Float64Array {
  const cumulative = new Float64Array(GROUPS);
  let total = 0;
  for (let group = 0; group < GROUPS; group++) {
    const index = Math.floor(group / FACE_NORMALS.length);
    const brightest = Math.max(radiance[index * 3], radiance[index * 3 + 1], radiance[index * 3 + 2]);
    total += (offsets[group + 1] - offsets[group]) * brightest * faceArea(group % FACE_NORMALS.length, scale);
    cumulative[group] = total;
  }
  return cumulative;
}

/** One face picked with probability proportional to its power. */
export type EmitterSample = { cell: number; index: number; face: number };

/** Picks a face by power: a group from `cumulative` with `pick`, a face within it with `within` (both in [0, 1)). */
export function sampleEmitter({ cells, offsets }: EmitterFaces, cumulative: Float64Array, pick: number, within: number): EmitterSample | null {
  const total = cumulative[GROUPS - 1];
  if (!(total > 0)) return null;
  const target = pick * total;
  let low = 0;
  let high = GROUPS - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] <= target) low = middle + 1;
    else high = middle;
  }
  const count = offsets[low + 1] - offsets[low];
  if (count === 0) return null;
  return { cell: cells[offsets[low] + Math.min(Math.floor(within * count), count - 1)], index: Math.floor(low / FACE_NORMALS.length), face: low % FACE_NORMALS.length };
}
