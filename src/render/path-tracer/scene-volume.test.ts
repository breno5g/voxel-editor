import { describe, expect, it } from 'vitest';
import { createModel, voxelIndex } from '../../format/vox.ts';
import type { Vec3, VoxModel } from '../../format/vox.ts';
import { IDENTITY_POSE } from '../../scene/scene-graph.ts';
import type { Instance } from '../../scene/scene-graph.ts';
import { BRICK, bakeSceneVolume } from './scene-volume.ts';

const instance = (model: number, translation: Vec3, rows = IDENTITY_POSE.rows): Instance => ({ transformId: model, shapeId: model, model, pose: { rows, translation } });
const cellAt = (volume: { size: Vec3; voxels: Uint8Array }, [x, y, z]: Vec3) => volume.voxels[x + volume.size[0] * (y + volume.size[1] * z)];

function bar(): VoxModel {
  const model = createModel([3, 1, 1]);
  model.voxels[voxelIndex(model.size, 0, 0, 0)] = 7;
  model.voxels[voxelIndex(model.size, 2, 0, 0)] = 9;
  return model;
}

describe('bakeSceneVolume', () => {
  it('returns null for an empty scene', () => {
    expect(bakeSceneVolume([], [])).toBeNull();
  });

  it('places voxels at their world cells around the model pivot', () => {
    const volume = bakeSceneVolume([instance(0, [10, 0, 0])], [bar()]);
    expect(volume?.origin).toEqual([9, 0, 0]);
    expect(volume?.size).toEqual([3, 1, 1]);
    if (!volume) return;
    expect([cellAt(volume, [0, 0, 0]), cellAt(volume, [1, 0, 0]), cellAt(volume, [2, 0, 0])]).toEqual([7, 0, 9]);
  });

  it('applies the instance rotation', () => {
    const quarterTurn = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const volume = bakeSceneVolume([instance(0, [0, 0, 0], quarterTurn)], [bar()]);
    expect(volume?.size).toEqual([1, 3, 1]);
    if (!volume) return;
    expect([cellAt(volume, [0, 0, 0]), cellAt(volume, [0, 2, 0])]).toEqual([7, 9]);
  });

  it('marks only the bricks holding voxels', () => {
    const far = createModel([1, 1, 1]);
    far.voxels[0] = 1;
    const volume = bakeSceneVolume([instance(0, [0, 0, 0]), instance(1, [BRICK * 2, 0, 0])], [far, far]);
    expect(volume && Array.from(volume.bricks)).toEqual([1, 0, 1]);
  });
});
