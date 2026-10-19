import * as THREE from 'three';
import { modelPivot } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { CHUNK_SIZE, chunkCounts, chunkOrigin, MAX_CHUNK_QUADS, meshChunk } from '../geometry/mesher.ts';

/** `offset` places the chunk so the model's pivot sits on its transform, as in MagicaVoxel. */
export type ChunkGeometry = { geometry: THREE.BufferGeometry; offset: Vec3 };

const QUAD_PATTERN = [0, 1, 2, 0, 2, 3];
const CHUNK_CENTER = new THREE.Vector3(CHUNK_SIZE / 2, CHUNK_SIZE / 2, CHUNK_SIZE / 2);
const CHUNK_RADIUS = (CHUNK_SIZE * Math.sqrt(3)) / 2;

/** One index buffer serves every chunk: quads always use the same 0,1,2 0,2,3 pattern. */
function createQuadIndex(): THREE.BufferAttribute {
  const indices = new Uint32Array(MAX_CHUNK_QUADS * 6);
  for (let quad = 0; quad < MAX_CHUNK_QUADS; quad++) {
    QUAD_PATTERN.forEach((corner, i) => {
      indices[quad * 6 + i] = quad * 4 + corner;
    });
  }
  return new THREE.BufferAttribute(indices, 1);
}

/** Detaches the shared index first: three.js would otherwise free its GPU buffer for every chunk. */
function disposeChunk(entry: ChunkGeometry | null): void {
  entry?.geometry.setIndex(null);
  entry?.geometry.dispose();
}

/** Chunked GPU geometry per model, rebuilt only for chunks an edit touches. */
export function createModelCache() {
  const cache = new Map<VoxModel, (ChunkGeometry | null)[]>();
  let quadIndex: THREE.BufferAttribute | null = null;

  const build = (model: VoxModel, chunk: number): ChunkGeometry | null => {
    const origin = chunkOrigin(model.size, chunk);
    const mesh = meshChunk(model, origin);
    if (mesh.quadCount === 0) return null;
    quadIndex ??= createQuadIndex();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Uint8BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('voxel', new THREE.Uint8BufferAttribute(mesh.voxels, 2));
    geometry.setIndex(quadIndex);
    geometry.setDrawRange(0, mesh.quadCount * 6);
    geometry.boundingSphere = new THREE.Sphere(CHUNK_CENTER.clone(), CHUNK_RADIUS);
    const pivot = modelPivot(model.size);
    return { geometry, offset: [origin[0] - pivot[0], origin[1] - pivot[1], origin[2] - pivot[2]] };
  };

  const chunks = (model: VoxModel): ChunkGeometry[] => {
    let entries = cache.get(model);
    if (!entries) {
      const [cx, cy, cz] = chunkCounts(model.size);
      entries = Array.from({ length: cx * cy * cz }, (_unused, chunk) => build(model, chunk));
      cache.set(model, entries);
    }
    return entries.filter((entry) => entry !== null);
  };

  const update = (model: VoxModel, dirty: Iterable<number>) => {
    const entries = cache.get(model);
    if (!entries) return;
    for (const chunk of dirty) {
      disposeChunk(entries[chunk]);
      entries[chunk] = build(model, chunk);
    }
  };

  const clear = () => {
    cache.forEach((entries) => entries.forEach(disposeChunk));
    cache.clear();
  };

  return { chunks, update, clear };
}
