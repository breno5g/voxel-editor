import type { Vec3, VoxModel } from '../format/vox.ts';

export const CHUNK_SIZE = 32;
export const MAX_CHUNK_QUADS = CHUNK_SIZE ** 3 * 6;

/**
 * Per quad: 4 vertices of `position` (u8 x3, chunk-local 0..32) and
 * `voxel` (u8 x2: face id 0..5 = +X -X +Y -Y +Z -Z, palette index).
 * Indices follow the fixed pattern 0,1,2 0,2,3 and are shared by every chunk.
 */
export type ChunkMesh = { positions: Uint8Array; voxels: Uint8Array; quadCount: number };

/** Counter-clockwise corners seen from outside each face. */
const FACE_CORNERS: readonly (readonly Vec3[])[] = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];

const scratchPositions = new Uint8Array(MAX_CHUNK_QUADS * 12);
const scratchVoxels = new Uint8Array(MAX_CHUNK_QUADS * 8);

export function chunkCounts(size: Vec3): Vec3 {
  return [Math.ceil(size[0] / CHUNK_SIZE), Math.ceil(size[1] / CHUNK_SIZE), Math.ceil(size[2] / CHUNK_SIZE)];
}

export function chunkOrigin(size: Vec3, chunk: number): Vec3 {
  const [cx, cy] = chunkCounts(size);
  return [(chunk % cx) * CHUNK_SIZE, (Math.floor(chunk / cx) % cy) * CHUNK_SIZE, Math.floor(chunk / (cx * cy)) * CHUNK_SIZE];
}

/** Chunks whose meshes change when voxel (x, y, z) changes: its own plus face-neighbours across a border. */
export function chunksTouching(size: Vec3, voxel: Vec3): number[] {
  const counts = chunkCounts(size);
  const home = voxel.map((axis) => Math.floor(axis / CHUNK_SIZE));
  const toIndex = (cell: number[]) => cell[0] + counts[0] * (cell[1] + counts[1] * cell[2]);
  const touched = [toIndex(home)];
  for (let axis = 0; axis < 3; axis++) {
    const local = voxel[axis] % CHUNK_SIZE;
    const neighbour = local === 0 ? home[axis] - 1 : local === CHUNK_SIZE - 1 ? home[axis] + 1 : null;
    if (neighbour === null || neighbour < 0 || neighbour >= counts[axis]) continue;
    touched.push(toIndex(home.map((value, i) => (i === axis ? neighbour : value))));
  }
  return touched;
}

/**
 * Emits only faces next to an empty cell (neighbours are read from the whole model,
 * so chunk borders are seamless).
 * ponytail: face culling only; greedy merging would cut vertices ~5-10x on flat
 * surfaces if GPU memory or upload time ever shows up in profiles.
 */
export function meshChunk(model: VoxModel, origin: Vec3): ChunkMesh {
  const [sx, sy, sz] = model.size;
  const { voxels } = model;
  const strideY = sx;
  const strideZ = sx * sy;
  const [ox, oy, oz] = origin;
  const endX = Math.min(ox + CHUNK_SIZE, sx);
  const endY = Math.min(oy + CHUNK_SIZE, sy);
  const endZ = Math.min(oz + CHUNK_SIZE, sz);
  let quads = 0;

  const emit = (face: number, x: number, y: number, z: number, color: number) => {
    const corners = FACE_CORNERS[face];
    let position = quads * 12;
    let attribute = quads * 8;
    for (const [cx, cy, cz] of corners) {
      scratchPositions[position++] = x + cx;
      scratchPositions[position++] = y + cy;
      scratchPositions[position++] = z + cz;
      scratchVoxels[attribute++] = face;
      scratchVoxels[attribute++] = color;
    }
    quads++;
  };

  for (let z = oz; z < endZ; z++) {
    for (let y = oy; y < endY; y++) {
      let index = ox + strideY * y + strideZ * z;
      for (let x = ox; x < endX; x++, index++) {
        const color = voxels[index];
        if (color === 0) continue;
        const lx = x - ox;
        const ly = y - oy;
        const lz = z - oz;
        if (x + 1 >= sx || voxels[index + 1] === 0) emit(0, lx, ly, lz, color);
        if (x === 0 || voxels[index - 1] === 0) emit(1, lx, ly, lz, color);
        if (y + 1 >= sy || voxels[index + strideY] === 0) emit(2, lx, ly, lz, color);
        if (y === 0 || voxels[index - strideY] === 0) emit(3, lx, ly, lz, color);
        if (z + 1 >= sz || voxels[index + strideZ] === 0) emit(4, lx, ly, lz, color);
        if (z === 0 || voxels[index - strideZ] === 0) emit(5, lx, ly, lz, color);
      }
    }
  }

  return { positions: scratchPositions.slice(0, quads * 12), voxels: scratchVoxels.slice(0, quads * 8), quadCount: quads };
}
