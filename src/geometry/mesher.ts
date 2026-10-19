import type { Vec3, VoxModel } from '../format/vox.ts';

export const CHUNK_SIZE = 32;
export const MAX_CHUNK_QUADS = CHUNK_SIZE ** 3 * 6;

/**
 * Per quad: 4 vertices of `position` (u8 x3, chunk-local 0..32) and `voxel` (u8 x3: face id
 * 0..5 = +X -X +Y -Y +Z -Z, palette index, ambient occlusion 0..3 = how many of the vertex's
 * three outer neighbours are filled). Indices follow the fixed pattern 0,1,2 0,2,3 and are shared
 * by every chunk; quads whose occlusion would shade across that diagonal start one corner later.
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
const VOXEL_STRIDE = 3;
const scratchVoxels = new Uint8Array(MAX_CHUNK_QUADS * 4 * VOXEL_STRIDE);

export function chunkCounts(size: Vec3): Vec3 {
  return [Math.ceil(size[0] / CHUNK_SIZE), Math.ceil(size[1] / CHUNK_SIZE), Math.ceil(size[2] / CHUNK_SIZE)];
}

/** Every chunk id of a model of `size`, for a full remesh. */
export function allChunks(size: Vec3): Set<number> {
  const [x, y, z] = chunkCounts(size);
  return new Set(Array.from({ length: x * y * z }, (_unused, chunk) => chunk));
}

export function chunkOrigin(size: Vec3, chunk: number): Vec3 {
  const [cx, cy] = chunkCounts(size);
  return [(chunk % cx) * CHUNK_SIZE, (Math.floor(chunk / cx) % cy) * CHUNK_SIZE, Math.floor(chunk / (cx * cy)) * CHUNK_SIZE];
}

/**
 * Chunks whose meshes change when voxel (x, y, z) changes: its own plus every neighbour (also across
 * edges and corners, which ambient occlusion reads) when the voxel sits on a shared border.
 */
export function chunksTouching(size: Vec3, voxel: Vec3): number[] {
  const counts = chunkCounts(size);
  const along = [0, 1, 2].map((axis) => {
    const home = Math.floor(voxel[axis] / CHUNK_SIZE);
    const local = voxel[axis] % CHUNK_SIZE;
    const neighbour = local === 0 ? home - 1 : local === CHUNK_SIZE - 1 ? home + 1 : null;
    return neighbour === null || neighbour < 0 || neighbour >= counts[axis] ? [home] : [home, neighbour];
  });
  return along[2].flatMap((z) => along[1].flatMap((y) => along[0].map((x) => x + counts[0] * (y + counts[1] * z))));
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

  const filled = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && voxels[x + strideY * y + strideZ * z] !== 0;
  const occlusion = new Uint8Array(4);

  /** Classic voxel AO: the two side neighbours and the diagonal one in the layer the face looks into. */
  const occlude = (face: number, x: number, y: number, z: number) => {
    const axis = face >> 1;
    const outward = face & 1 ? -1 : 1;
    const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
    FACE_CORNERS[face].forEach((corner, index) => {
      const cell = [x, y, z];
      cell[axis] += outward;
      const du = corner[u] * 2 - 1;
      const dv = corner[v] * 2 - 1;
      const side = (offsetU: number, offsetV: number) => {
        const probe = [...cell];
        probe[u] += offsetU;
        probe[v] += offsetV;
        return filled(probe[0], probe[1], probe[2]) ? 1 : 0;
      };
      const [first, second] = [side(du, 0), side(0, dv)];
      occlusion[index] = first && second ? 3 : first + second + side(du, dv);
    });
  };

  const emit = (face: number, x: number, y: number, z: number, color: number) => {
    occlude(face, x + ox, y + oy, z + oz);
    const corners = FACE_CORNERS[face];
    const start = occlusion[0] + occlusion[2] < occlusion[1] + occlusion[3] ? 1 : 0;
    let position = quads * 12;
    let attribute = quads * 4 * VOXEL_STRIDE;
    for (let step = 0; step < 4; step++) {
      const index = (start + step) % 4;
      const [cx, cy, cz] = corners[index];
      scratchPositions[position++] = x + cx;
      scratchPositions[position++] = y + cy;
      scratchPositions[position++] = z + cz;
      scratchVoxels[attribute++] = face;
      scratchVoxels[attribute++] = color;
      scratchVoxels[attribute++] = occlusion[index];
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

  return { positions: scratchPositions.slice(0, quads * 12), voxels: scratchVoxels.slice(0, quads * 4 * VOXEL_STRIDE), quadCount: quads };
}
