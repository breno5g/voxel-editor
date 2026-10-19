import type { Vec3 } from '../../format/vox.ts';
import type { SceneVolume } from './scene-volume.ts';

/** Face directions, negative before positive per axis: an odd face lies on the cell's far side. */
const FACES = 6;
const PALETTE_INDICES = 256;
/** Emitter groups: one per palette index and face direction, `index·6 + face`. */
export const EMITTER_GROUPS = PALETTE_INDICES * FACES;
/** Faces per row of the GPU's face texture: every WebGL2 device takes 2048-wide textures. */
export const EMITTER_ROW = 2048;

/**
 * Every face light can leave an area-light voxel by, grouped by palette index and direction like
 * MagicaVoxel's emitter list: `faces` holds `cell·8 + face` (the grid stays under 2²⁹ cells), group
 * `index·6 + face` spans `offsets[group]` up to `offsets[group + 1]`.
 */
export type EmitterFaces = { faces: Uint32Array; offsets: Uint32Array };

/**
 * The faces of voxels whose index `emits` that border an empty cell or one light crosses (`clear`).
 * `emits` and `clear` are flags per palette index.
 */
export function collectEmitterFaces({ size, voxels }: SceneVolume, emits: Uint8Array, clear: Uint8Array): EmitterFaces {
  const offsets = new Uint32Array(EMITTER_GROUPS + 1);
  if (!emits.some((flag) => flag !== 0)) return { faces: new Uint32Array(0), offsets };
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
          for (let face = 0; face < FACES; face++) if (open(cell, coordinate, face)) each(color * FACES + face, cell);
        }
      }
    }
  };
  visit((group) => offsets[group + 1]++);
  for (let group = 0; group < EMITTER_GROUPS; group++) offsets[group + 1] += offsets[group];
  const faces = new Uint32Array(offsets[EMITTER_GROUPS]);
  const filled = offsets.slice(0, EMITTER_GROUPS);
  visit((group, cell) => (faces[filled[group]++] = cell * 8 + (group % FACES)));
  return { faces, offsets };
}

/** World area of a face in direction `face` of a cell scaled by `scale`. */
const faceArea = (face: number, [x, y, z]: Vec3) => [y * z, x * z, x * y][face >> 1];

/**
 * Each group's share of the total power, running (faces · brightest channel of its radiance · face
 * area, as MagicaVoxel sums it), and the total; `radiance` is linear RGB per palette index.
 * A pixel picks a group where the running share first exceeds a uniform draw, then a face within it.
 */
export function emitterPower({ offsets }: EmitterFaces, radiance: Float32Array, scale: Vec3): { cumulative: Float32Array; total: number } {
  const running = new Float64Array(EMITTER_GROUPS);
  let total = 0;
  for (let group = 0; group < EMITTER_GROUPS; group++) {
    const index = Math.floor(group / FACES);
    const brightest = Math.max(radiance[index * 3], radiance[index * 3 + 1], radiance[index * 3 + 2]);
    total += (offsets[group + 1] - offsets[group]) * brightest * faceArea(group % FACES, scale);
    running[group] = total;
  }
  return { cumulative: Float32Array.from(running, (value) => (total > 0 ? value / total : 0)), total };
}
