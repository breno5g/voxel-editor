import { describe, expect, it } from 'vitest';
import { createModel, voxelIndex } from '../format/vox.ts';
import type { Vec3, VoxModel } from '../format/vox.ts';
import { chunkCounts, chunkOrigin, chunksTouching, meshChunk } from './mesher.ts';

function modelWith(size: Vec3, cells: Vec3[]): VoxModel {
  const model = createModel(size);
  cells.forEach(([x, y, z]) => {
    model.voxels[voxelIndex(size, x, y, z)] = 7;
  });
  return model;
}

const totalQuads = (model: VoxModel) => {
  const [cx, cy, cz] = chunkCounts(model.size);
  return Array.from({ length: cx * cy * cz }, (_unused, chunk) => meshChunk(model, chunkOrigin(model.size, chunk)).quadCount)
    .reduce((sum, quads) => sum + quads, 0);
};

describe('meshChunk', () => {
  it('emits six faces for a lone voxel', () => {
    const mesh = meshChunk(modelWith([4, 4, 4], [[1, 1, 1]]), [0, 0, 0]);
    expect(mesh.quadCount).toBe(6);
    expect(mesh.positions).toHaveLength(6 * 4 * 3);
  });

  it('culls the faces shared by adjacent voxels', () => {
    expect(meshChunk(modelWith([4, 4, 4], [[1, 1, 1], [2, 1, 1]]), [0, 0, 0]).quadCount).toBe(10);
  });

  it('culls across chunk borders', () => {
    expect(totalQuads(modelWith([64, 4, 4], [[31, 1, 1], [32, 1, 1]]))).toBe(10);
  });

  it('tags every vertex with its face id and palette index', () => {
    const { voxels } = meshChunk(modelWith([2, 2, 2], [[0, 0, 0]]), [0, 0, 0]);
    const faces = new Set(voxels.filter((_value, i) => i % 3 === 0));
    expect([...faces].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(voxels.filter((_value, i) => i % 3 === 1).every((color) => color === 7)).toBe(true);
  });

  it('occludes the corners of a floor next to a wall', () => {
    const model = modelWith([3, 3, 2], [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0], [1, 2, 1]]);
    const { positions, voxels, quadCount } = meshChunk(model, [0, 0, 0]);
    const topOf = (x: number, y: number) =>
      Array.from({ length: quadCount }, (_unused, quad) => quad).find((quad) => voxels[quad * 12] === 4 && positions[quad * 12] >= x && positions[quad * 12] <= x + 1 && positions[quad * 12 + 1] >= y && positions[quad * 12 + 1] <= y + 1 && positions[quad * 12 + 2] === 1);
    const occlusionOf = (quad: number | undefined) => (quad === undefined ? [] : [0, 1, 2, 3].map((corner) => voxels[quad * 12 + corner * 3 + 2]));
    expect(occlusionOf(topOf(0, 0))).toEqual([0, 0, 0, 0]);
    expect(Math.max(...occlusionOf(topOf(1, 1)))).toBe(1);
  });
});

describe('chunksTouching', () => {
  it('includes the neighbour chunk only when the voxel sits on a shared border', () => {
    const size: Vec3 = [64, 64, 32];
    expect(chunksTouching(size, [10, 10, 10])).toEqual([0]);
    expect(chunksTouching(size, [31, 10, 10])).toEqual([0, 1]);
    // Chunk (1,1,0) = 3, its -X neighbour (0,1,0) = 2, -Y neighbour (1,0,0) = 1 and the diagonal (0,0,0) = 0.
    expect(chunksTouching(size, [32, 32, 10]).sort()).toEqual([0, 1, 2, 3]);
  });
});
