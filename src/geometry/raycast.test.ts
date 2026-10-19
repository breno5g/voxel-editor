import { describe, expect, it } from 'vitest';
import { createModel, voxelIndex } from '../format/vox.ts';
import { raycastFloor, raycastVoxels } from './raycast.ts';

const model = createModel([8, 8, 8]);
model.voxels[voxelIndex(model.size, 3, 4, 5)] = 1;

describe('raycastVoxels', () => {
  it('hits the first filled voxel and reports the face it entered through', () => {
    const hit = raycastVoxels(model, [3.5, 4.5, 20], [0, 0, -1]);
    expect(hit?.voxel).toEqual([3, 4, 5]);
    expect(hit?.normal).toEqual([0, 0, 1]);
    expect(hit?.distance).toBeCloseTo(14);
  });

  it('reports side faces for diagonal rays', () => {
    const hit = raycastVoxels(model, [-2, 4.5, 5.5], [1, 0, 0.0001]);
    expect(hit?.voxel).toEqual([3, 4, 5]);
    expect(hit?.normal).toEqual([-1, 0, 0]);
  });

  it('misses empty space and rays that never enter the model', () => {
    expect(raycastVoxels(model, [0.5, 0.5, 20], [0, 0, -1])).toBeNull();
    expect(raycastVoxels(model, [20, 20, 20], [1, 0, 0])).toBeNull();
  });
});

describe('raycastFloor', () => {
  it('returns the bottom-layer cell under the ray', () => {
    expect(raycastFloor(model, [2.5, 6.5, 10], [0, 0, -1])).toEqual([2, 6, 0]);
  });

  it('ignores rays pointing away or landing outside the model', () => {
    expect(raycastFloor(model, [2.5, 6.5, 10], [0, 0, 1])).toBeNull();
    expect(raycastFloor(model, [20.5, 6.5, 10], [0, 0, -1])).toBeNull();
  });
});
